/** Minimal MediaRecorder wrapper for mic capture -> ASR. */
import { trimToSpeech, warmVad } from './vad'

/** Shorter than this and there is nothing to transcribe — don't send it. */
export const MIN_CLIP_MS = 400

export interface Take {
  /** Speech only (Silero VAD), or null when the take held no speech at all. */
  blob: Blob | null
  /** How long the user held the mic. */
  durationMs: number
  /** Milliseconds of actual speech the VAD found in it. */
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
    // The screen was left while the permission prompt was up: let the mic go.
    if (this.#disposed) return stopTracks(stream)
    this.#stream = stream
    this.#chunks = []
    this.#rec = createRecorder(this.#stream, (data) => {
      if (data.size) this.#chunks.push(data)
    })
    this.#startedAt = Date.now()
    this.#rec.start()
    // Fetch the VAD weights while the user is talking, not after.
    warmVad()
  }

  /**
   * Stops the mic and trims the take to the speech in it (DESIGN §9.3), so the
   * tap, the breaths and the thinking pauses never leave the phone.
   */
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

  /** Stops the MediaRecorder, tears down the mic and resolves the raw clip. */
  #finish(rec: MediaRecorder): Promise<Blob> {
    return new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        this.#release()
        resolve(new Blob(this.#chunks, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.stop()
    })
  }

  /**
   * Lets go of the mic for good, discarding any take in progress. Call it when
   * the owning screen unmounts — otherwise the recording indicator stays lit
   * after the user has navigated away.
   */
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
    // Raw-ish mic: browser noise suppression is tuned for phone calls and smears
    // the consonants the ASR needs. Keep echo cancellation (TTS may be playing)
    // but leave gain/level to the browser.
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
    // Opus defaults can be voice-narrowband; give the ASR real bandwidth.
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
