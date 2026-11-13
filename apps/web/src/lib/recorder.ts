/** Minimal MediaRecorder wrapper for mic capture -> ASR. */
export class Recorder {
  #rec: MediaRecorder | null = null
  #stream: MediaStream | null = null
  #chunks: Blob[] = []

  get recording(): boolean {
    return this.#rec?.state === 'recording'
  }

  async start(): Promise<void> {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    this.#chunks = []
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t))
    this.#rec = new MediaRecorder(this.#stream, mimeType ? { mimeType } : undefined)
    this.#rec.ondataavailable = (e) => {
      if (e.data.size) this.#chunks.push(e.data)
    }
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
