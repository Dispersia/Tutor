import { api } from './api'
import type { SpeechStatus } from './types'

let currentAudio: HTMLAudioElement | null = null

function play(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stopAudio()
    const a = new Audio(url)
    currentAudio = a
    a.onended = () => {
      if (currentAudio === a) currentAudio = null
      resolve()
    }
    a.onerror = () => reject(new Error('audio playback failed'))
    a.play().catch(reject)
  })
}

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

/** Synthesises and plays one chunk of text via the local Qwen3-TTS. */
export async function speak(
  text: string,
  opts: { voice?: string; language?: string; mode?: 'preset' | 'design' } = {},
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/speech/tts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...opts }),
    signal,
  })
  if (!res.ok) throw new Error(`tts failed: ${await res.text().catch(() => res.status)}`)
  const url = URL.createObjectURL(await res.blob())
  try {
    await play(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Transcribes a recorded clip with the local Qwen3-ASR. */
export async function transcribe(blob: Blob, language?: string): Promise<string> {
  const fd = new FormData()
  fd.set('file', blob, 'clip.webm')
  if (language) fd.set('language', language)
  const res = await fetch('/api/speech/asr', {
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
