/** Minimal MediaRecorder wrapper for mic capture -> ASR. */

/** Shorter than this and there is nothing to transcribe — don't send it. */
export const MIN_CLIP_MS = 400

export class Recorder {
  #rec: MediaRecorder | null = null
  #stream: MediaStream | null = null
  #chunks: Blob[] = []
  #startedAt = 0

  get recording(): boolean {
    return this.#rec?.state === 'recording'
  }

  /** How long the current (or just-finished) take has been running, in ms. */
  get elapsedMs(): number {
    return this.#startedAt ? Date.now() - this.#startedAt : 0
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
  }

  stop(): Promise<Blob> {
    const rec = this.#rec
    if (!rec) return Promise.resolve(new Blob())
    return new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        this.#stream?.getTracks().forEach((t) => t.stop())
        this.#stream = null
        this.#rec = null
        resolve(new Blob(this.#chunks, { type: rec.mimeType || 'audio/webm' }))
      }
      rec.stop()
    })
  }
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  )
}
