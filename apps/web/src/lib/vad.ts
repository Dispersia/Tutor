/**
 * Silero VAD in the browser, so dead air never reaches the speech models.
 *
 * A push-to-talk take is mostly silence: the tap, the breath, the thinking pause
 * in the middle of a sentence. Feeding all of that to the ASR costs a model load,
 * a slow decode and a real risk of a hallucinated transcript on the silent parts.
 * So every take is run through Silero (ONNX, on the phone) and only the speech
 * windows are kept, spliced into one 16 kHz WAV.
 *
 * Everything here is best-effort: if the weights or the wasm runtime cannot be
 * fetched, the raw take goes to the server unchanged (the gateway has its own
 * energy guard) rather than the mic breaking.
 */
import type { NonRealTimeVAD } from '@ricky0123/vad-web'
import { encodeWav, speechWindows, spliceWindows, spokenMs, type Segment } from './audio'
import { href } from './paths'

/** What the ASR models actually want; also 3x smaller than the 48 kHz capture. */
const TARGET_RATE = 16_000
/**
 * Below this there was no real speech — don't wake the model for it. Also the
 * shortest burst Silero keeps: a cough or a door is not a word, but a single
 * syllable answer ("是") must survive.
 */
const MIN_SPEECH_MS = 120

/** A cold-start download may take a while; a take should not wait longer than this. */
const VAD_WAIT_MS = 15_000

export interface Trim {
  /** The audio to upload, or null when the take held no speech at all. */
  blob: Blob | null
  /** Length of the original take. */
  durationMs: number
  /** Milliseconds of actual speech found in it. */
  speechMs: number
  /** False when Silero could not run and `blob` is the untouched take. */
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
/** After one failure the asset/runtime is not going to appear mid-session. */
let broken = false

/**
 * Starts downloading the VAD weights and the onnxruntime wasm in the background,
 * so the first stop does not wait for ~16 MB. Called when the mic opens: the
 * user is talking while it lands.
 */
export function warmVad(): void {
  void loadVad().catch(() => {})
}

/**
 * Trims a take down to the speech in it. Never throws: on any failure the
 * original blob comes back with `vad: false`.
 */
export async function trimToSpeech(blob: Blob): Promise<Trim> {
  const raw: Trim = { blob, durationMs: 0, speechMs: 0, vad: false }
  if (!blob.size) return { ...raw, blob: null }

  let decoded: Decoded
  try {
    decoded = await decode(blob)
  } catch {
    return raw // the browser could not decode its own container — send it as-is
  }
  const durationMs = (decoded.pcm.length / decoded.sampleRate) * 1000
  const pass = { ...raw, durationMs }
  if (!durationMs) return { ...pass, blob: null }

  let segments: Segment[]
  try {
    segments = await findSpeech(decoded)
  } catch {
    return pass
  }

  const speechMs = spokenMs(segments)
  if (speechMs < MIN_SPEECH_MS) {
    // Detected silence, not a failure: nothing worth transcribing.
    return { ...pass, speechMs, vad: true, blob: null }
  }

  try {
    const windows = speechWindows(segments, durationMs)
    const kept = spliceWindows(decoded.pcm, decoded.sampleRate, windows)
    const pcm = await resample(kept, decoded.sampleRate)
    return { ...pass, speechMs, vad: true, blob: encodeWav(pcm, TARGET_RATE) }
  } catch {
    return pass
  }
}

async function loadVad(): Promise<NonRealTimeVAD> {
  if (broken) throw new Error('vad unavailable')
  loaded ??= (async () => {
    const assets = await vadAssets()
    const mod = (await import('@ricky0123/vad-web')) as typeof import('@ricky0123/vad-web') & {
      default?: typeof import('@ricky0123/vad-web')
    }
    // dist/ is CommonJS, so the named export can arrive either way depending on
    // how the bundler ran the interop.
    const NonRealTimeVAD = mod.NonRealTimeVAD ?? mod.default?.NonRealTimeVAD
    if (!NonRealTimeVAD) throw new Error('vad module has no NonRealTimeVAD')
    return NonRealTimeVAD.new({
      modelURL: assets.model,
      // Tuned for a language lesson: short words count as speech, and a pause in
      // the middle of a sentence cuts the clip instead of dragging silence along.
      minSpeechMs: MIN_SPEECH_MS,
      preSpeechPadMs: 300,
      redemptionMs: 700,
      ortConfig: (ort) => {
        // Single-threaded: threads need cross-origin isolation (SharedArrayBuffer),
        // which we do not require just to trim a clip.
        ort.env.wasm.numThreads = 1
        ort.env.wasm.wasmPaths = { wasm: assets.wasm, mjs: assets.mjs }
      },
    })
  })()
  try {
    return await loaded
  } catch (err) {
    broken = true
    loaded = null
    throw err
  }
}

/** Reads the manifest `scripts/sync-vad-assets.mjs` writes next to the build. */
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

/**
 * Waits for the model, but never holds a transcript hostage to a slow download:
 * the first take after a cold start falls back to the raw clip instead.
 */
async function vadWithin(ms: number): Promise<NonRealTimeVAD> {
  const loading = loadVad()
  loading.catch(() => {}) // settled by the race; keep a late rejection quiet
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
  // The interface omits it, but NonRealTimeVAD always holds a real FrameProcessor.
  const proc = vad.frameProcessor as typeof vad.frameProcessor & { reset: () => void }
  // State (and the model's recurrent state) survives a run; start each take clean.
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
    // MediaRecorder is configured mono, but mp4/m4a takes can come back stereo.
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

/** Browser-side rate conversion, which is polyphase rather than interpolating. */
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
