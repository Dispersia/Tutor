/**
 * TypeScript client for the local speech gateway (python/speech), behind a
 * provider interface so we can add cloud fallbacks later without touching the app
 * (DESIGN §9.1, §9.4).
 */

export interface AsrSegment {
  text: string
  start: number
  end: number
}

export interface AsrResult {
  text: string
  lang?: string
  segments?: AsrSegment[]
}

export interface AlignItem {
  text: string
  start: number
  end: number
}

export interface TtsOptions {
  voice?: string
  language?: string
  /** free-form style/emotion instruction */
  instruct?: string
  /** preset (CustomVoice) or design (VoiceDesign) */
  mode?: 'preset' | 'design'
}

export interface SpeechHealth {
  ready: boolean
  models: string[]
  rssBytes?: number
  lastActivity: number
}

export interface SpeechProvider {
  asr(audio: Blob | Uint8Array, opts?: { language?: string; hint?: string }): Promise<AsrResult>
  align(audio: Blob | Uint8Array, text: string, opts?: { language?: string }): Promise<AlignItem[]>
  tts(text: string, opts?: TtsOptions): Promise<Uint8Array>
  health(): Promise<SpeechHealth>
  unload(): Promise<void>
}

export interface GatewayOptions {
  baseUrl?: string
  timeoutMs?: number
}

/** Talks to the local MLX speech gateway over HTTP. */
export class GatewaySpeechProvider implements SpeechProvider {
  readonly baseUrl: string
  #timeoutMs: number

  constructor(opts: GatewayOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:4319').replace(/\/$/, '')
    this.#timeoutMs = opts.timeoutMs ?? 120_000
  }

  async health(): Promise<SpeechHealth> {
    const res = await this.#fetch('/health')
    return (await res.json()) as SpeechHealth
  }

  async unload(): Promise<void> {
    await this.#fetch('/admin/unload', { method: 'POST' })
  }

  async asr(audio: Blob | Uint8Array, opts: { language?: string; hint?: string } = {}) {
    const form = new FormData()
    form.set('file', toBlob(audio))
    if (opts.language) form.set('language', opts.language)
    if (opts.hint) form.set('hint', opts.hint)
    const res = await this.#fetch('/v1/asr', { method: 'POST', body: form })
    return (await res.json()) as AsrResult
  }

  async align(audio: Blob | Uint8Array, text: string, opts: { language?: string } = {}) {
    const form = new FormData()
    form.set('file', toBlob(audio))
    form.set('text', text)
    if (opts.language) form.set('language', opts.language)
    const res = await this.#fetch('/v1/align', { method: 'POST', body: form })
    const json = (await res.json()) as { items: AlignItem[] }
    return json.items
  }

  async tts(text: string, opts: TtsOptions = {}): Promise<Uint8Array> {
    const res = await this.#fetch('/v1/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...opts }),
    })
    return new Uint8Array(await res.arrayBuffer())
  }

  async #fetch(path: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs)
    try {
      const res = await fetch(this.baseUrl + path, { ...init, signal: ctrl.signal })
      if (!res.ok) throw new Error(`speech gateway ${path} -> ${res.status}`)
      return res
    } finally {
      clearTimeout(timer)
    }
  }
}

function toBlob(audio: Blob | Uint8Array): Blob {
  if (audio instanceof Blob) return audio
  const buf = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength,
  ) as ArrayBuffer
  return new Blob([buf], { type: 'audio/wav' })
}
