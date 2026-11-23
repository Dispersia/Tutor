import { trimToSpeech, warmVad } from './vad'

export const MIN_CLIP_MS = 400

export interface Take {
  blob: Blob | null
  durationMs: number
  speechMs: number
}

export class Recorder {
  #rec: MediaRecorder | null = null
  #stream: MediaStream | null = null
  #chunks: Blob[] = []
  #startedAt = 0
  #disposed = false

  get recording(): boolean {
    return this.#rec?.state === 'recording'
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() })
    if (this.#disposed) return stopTracks(stream)
    this.#stream = stream
    this.#chunks = []
    this.#rec = createRecorder(this.#stream, (data) => {
      if (data.size) this.#chunks.push(data)
    })
    this.#startedAt = Date.now()
    this.#rec.start()
    warmVad()
  }

  async stop(): Promise<Take> {
    const rec = this.#rec
    if (!rec) return { blob: null, durationMs: 0, speechMs: 0 }
    const raw = await this.#finish(rec)
    const durationMs = this.#startedAt ? Date.now() - this.#startedAt : 0
    this.#startedAt = 0
    this.#chunks = []
    const trim = await trimToSpeech(raw)
    return {
      blob: trim.blob,
      durationMs: trim.durationMs || durationMs,
      speechMs: trim.speechMs,
    }
  }

  #finish(rec: MediaRecorder): Promise<Blob> {
    return new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        this.#release()
        resolve(new Blob(this.#chunks, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.stop()
    })
  }

  dispose(): void {
    this.#disposed = true
    const rec = this.#rec
    if (rec && rec.state !== 'inactive') rec.stop()
    this.#release()
  }

  #release(): void {
    if (this.#stream) stopTracks(this.#stream)
    this.#stream = null
    this.#rec = null
  }
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop())
}

function micConstraints(): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  }
}

function createRecorder(stream: MediaStream, onData: (data: Blob) => void): MediaRecorder {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t))
  const rec = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 128_000,
  })
  rec.ondataavailable = (e) => onData(e.data)
  return rec
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  )
}
