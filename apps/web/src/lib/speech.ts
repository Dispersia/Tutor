import { api } from './api'
import { apiPath } from './paths'
import type { SpeechStatus } from './types'

let currentAudio: HTMLAudioElement | null = null

function play(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stopAudio()
    const a = new Audio(url)
    currentAudio = a
    let settled = false
    // `pause` fires when we stop playback mid-clip (stopAudio); resolve so callers
    // waiting on the clip do not hang forever.
    const done = () => {
      if (settled) return
      settled = true
      if (currentAudio === a) currentAudio = null
      resolve()
    }
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error('audio playback failed'))
    }
    a.onended = done
    a.onpause = done
    a.onerror = () => fail(new Error('audio playback failed'))
    a.play().catch(fail)
  })
}

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

export interface SpeakOptions {
  voice?: string
  language?: string
  mode?: 'preset' | 'design'
}

/** Requests one chunk of TTS audio; resolves to the WAV blob. */
async function fetchTts(text: string, opts: SpeakOptions, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(apiPath('/api/speech/tts'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...opts }),
    signal,
  })
  if (!res.ok) throw new Error(`tts failed: ${await res.text().catch(() => res.status)}`)
  return res.blob()
}

/** Synthesises and plays one chunk of text via the local Qwen3-TTS. */
export async function speak(
  text: string,
  opts: SpeakOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  const url = URL.createObjectURL(await fetchTts(text, opts, signal))
  try {
    await play(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface Speaker {
  /** Queues a sentence; its audio is synthesised immediately, in the background. */
  push(text: string): void
  /** Waits until everything queued so far has played. */
  close(): Promise<void>
  /** Stops playback and drops anything still queued. */
  cancel(): void
}

/**
 * Speaks sentences in order while synthesising ahead. Playback starts as soon as
 * the first sentence is known, and each later sentence is already rendered by the
 * time the previous one finishes, so there is no gap between sentences and no
 * wait for the whole reply (DESIGN §9.2).
 */
export function createSpeaker(opts: SpeakOptions = {}, onError?: (err: Error) => void): Speaker {
  const queue: { text: string; audio: Promise<Blob> }[] = []
  let cancelled = false
  let closed = false
  let wake: (() => void) | null = null

  const report = (e: unknown) => onError?.(e instanceof Error ? e : new Error(String(e)))

  async function loop(): Promise<void> {
    while (!cancelled) {
      if (queue.length === 0) {
        if (closed) break
        await new Promise<void>((r) => (wake = r))
        continue
      }
      const item = queue.shift()!
      try {
        const blob = await item.audio
        if (cancelled) break
        const url = URL.createObjectURL(blob)
        try {
          await play(url)
        } finally {
          URL.revokeObjectURL(url)
        }
      } catch (e) {
        report(e)
      }
    }
  }

  const started = loop()

  const signal = () => {
    if (wake) {
      const r = wake
      wake = null
      r()
    }
  }

  return {
    push(text: string) {
      const t = text.trim()
      if (cancelled || closed || !t) return
      const audio = fetchTts(t, opts)
      // If cancel() drops this item before the loop awaits it, the rejection must
      // not surface as an unhandled promise rejection.
      audio.catch(() => {})
      queue.push({ text: t, audio })
      signal()
    },
    async close() {
      closed = true
      signal()
      await started
    },
    cancel() {
      cancelled = true
      closed = true
      queue.length = 0
      signal()
      stopAudio()
    },
  }
}

/** Transcribes a recorded clip with the local Qwen3-ASR. */
export async function transcribe(blob: Blob, language?: string): Promise<string> {
  const fd = new FormData()
  fd.set('file', blob, 'clip.webm')
  if (language) fd.set('language', language)
  const res = await fetch(apiPath('/api/speech/asr'), {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  })
  if (!res.ok) throw new Error(`asr failed: ${await res.text().catch(() => res.status)}`)
  return ((await res.json()) as { text: string }).text
}

export const speechStatus = () => api<SpeechStatus>('/api/speech/health')
export const wakeSpeech = () => api<SpeechStatus>('/api/speech/wake', { method: 'POST' })
export const unloadSpeech = () => api<{ ok: boolean }>('/api/speech/unload', { method: 'POST' })
