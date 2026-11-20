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

  get recording(): boolean {
    return this.#rec?.state === 'recording'
  }

  async start(): Promise<void> {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Raw-ish mic: browser noise suppression is tuned for phone calls and
        // smears the consonants the ASR needs. Keep echo cancellation (TTS may be
        // playing) but leave gain/level to the browser.
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
    })
    this.#chunks = []
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t))
    this.#rec = new MediaRecorder(this.#stream, {
      ...(mimeType ? { mimeType } : {}),
      // Opus defaults can be voice-narrowband; give the ASR real bandwidth.
      audioBitsPerSecond: 128_000,
    })
    this.#rec.ondataavailable = (e) => {
      if (e.data.size) this.#chunks.push(e.data)
    }
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
    const raw = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        this.#stream?.getTracks().forEach((t) => t.stop())
        this.#stream = null
        this.#rec = null
        resolve(new Blob(this.#chunks, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.stop()
    })
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
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  )
}
