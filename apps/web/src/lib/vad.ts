import type { NonRealTimeVAD } from '@ricky0123/vad-web'
import { encodeWav, speechWindows, spliceWindows, spokenMs, type Segment } from './audio'
import { href } from './paths'

const TARGET_RATE = 16_000
const MIN_SPEECH_MS = 120

const VAD_WAIT_MS = 15_000

export interface Trim {
  blob: Blob | null
  durationMs: number
  speechMs: number
  vad: boolean
}

interface Assets {
  model: string
  wasm: string
  mjs: string
}

interface Decoded {
  pcm: Float32Array
  sampleRate: number
}

let loaded: Promise<NonRealTimeVAD> | null = null
const RETRY_AFTER_MS = 60_000
let failedAt = 0

export function warmVad(): void {
  void loadVad().catch(() => {})
}

export async function trimToSpeech(blob: Blob): Promise<Trim> {
  const raw: Trim = { blob, durationMs: 0, speechMs: 0, vad: false }
  if (!blob.size) return { ...raw, blob: null }

  const decoded = await decodeOrNull(blob)
  if (!decoded) return raw
  const durationMs = (decoded.pcm.length / decoded.sampleRate) * 1000
  const pass = { ...raw, durationMs }
  if (!durationMs) return { ...pass, blob: null }

  const segments = await speechOrNull(decoded)
  if (!segments) return pass
  const speechMs = spokenMs(segments)
  if (speechMs < MIN_SPEECH_MS) return { ...pass, speechMs, vad: true, blob: null }

  const trimmed = await encodeTrimmed(decoded, segments, durationMs)
  if (!trimmed) return pass
  return { ...pass, speechMs, vad: true, blob: trimmed }
}

async function decodeOrNull(blob: Blob): Promise<Decoded | undefined> {
  try {
    return await decode(blob)
  } catch {
    return undefined
  }
}

async function speechOrNull(decoded: Decoded): Promise<Segment[] | undefined> {
  try {
    return await findSpeech(decoded)
  } catch {
    return undefined
  }
}

async function encodeTrimmed(
  decoded: Decoded,
  segments: Segment[],
  durationMs: number,
): Promise<Blob | null> {
  try {
    const windows = speechWindows(segments, durationMs)
    const kept = spliceWindows(decoded.pcm, decoded.sampleRate, windows)
    const pcm = await resample(kept, decoded.sampleRate)
    return encodeWav(pcm, TARGET_RATE)
  } catch {
    return null
  }
}

async function loadVad(): Promise<NonRealTimeVAD> {
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) throw new Error('vad unavailable')
  const attempt = (loaded ??= loadOnce())
  try {
    const vad = await attempt
    failedAt = 0
    return vad
  } catch (err) {
    if (loaded === attempt) {
      loaded = null
      failedAt = Date.now()
    }
    throw err
  }
}

async function loadOnce(): Promise<NonRealTimeVAD> {
  const NonRealTimeVAD = await loadModule()
  const assets = await vadAssets()
  return NonRealTimeVAD.new({
    modelURL: assets.model,
    minSpeechMs: MIN_SPEECH_MS,
    preSpeechPadMs: 300,
    redemptionMs: 700,
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1
      ort.env.wasm.wasmPaths = { wasm: assets.wasm, mjs: assets.mjs }
    },
  })
}

async function loadModule() {
  const mod = (await import('@ricky0123/vad-web')) as typeof import('@ricky0123/vad-web') & {
    default?: typeof import('@ricky0123/vad-web')
  }
  const NonRealTimeVAD = mod.NonRealTimeVAD ?? mod.default?.NonRealTimeVAD
  if (!NonRealTimeVAD) throw new Error('vad module has no NonRealTimeVAD')
  return NonRealTimeVAD
}

async function vadAssets(): Promise<Assets> {
  const res = await fetch(href('/vad/manifest.json'))
  if (!res.ok) throw new Error(`vad assets missing (${res.status})`)
  const json = (await res.json()) as Partial<Record<keyof Assets, string>>
  if (!json.model || !json.wasm || !json.mjs) throw new Error('vad manifest incomplete')
  return {
    model: href(`/vad/${json.model}`),
    wasm: href(`/vad/${json.wasm}`),
    mjs: href(`/vad/${json.mjs}`),
  }
}

async function vadWithin(ms: number): Promise<NonRealTimeVAD> {
  const loading = loadVad()
  loading.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      loading,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('vad load timed out')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function findSpeech({ pcm, sampleRate }: Decoded): Promise<Segment[]> {
  const vad = await vadWithin(VAD_WAIT_MS)
  const proc = vad.frameProcessor as typeof vad.frameProcessor & { reset: () => void }
  proc.reset()
  proc.resume()
  const out: Segment[] = []
  for await (const seg of vad.run(pcm, sampleRate)) {
    out.push({ start: seg.start, end: seg.end })
  }
  return out
}

async function decode(blob: Blob): Promise<Decoded> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const pcm =
      buf.numberOfChannels === 1 ? buf.getChannelData(0) : mixdown(buf.numberOfChannels, buf)
    return { pcm, sampleRate: buf.sampleRate }
  } finally {
    void ctx.close()
  }
}

function mixdown(channels: number, buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length)
  for (let c = 0; c < channels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += data[i] / channels
  }
  return out
}

async function resample(pcm: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (sampleRate === TARGET_RATE) return pcm
  const frames = Math.max(1, Math.ceil((pcm.length * TARGET_RATE) / sampleRate))
  const ctx = new OfflineAudioContext(1, frames, TARGET_RATE)
  const buf = ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate)
  buf.getChannelData(0).set(pcm)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return out.getChannelData(0)
}
