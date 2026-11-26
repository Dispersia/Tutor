import { api } from './api'
import { href } from './paths'
import type { SpeechStatus } from './types'

let currentAudio: HTMLAudioElement | null = null

function play(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stopAudio()
    const a = new Audio(url)
    currentAudio = a
    const { done, fail } = onceSettler(a, resolve, reject)
    a.onended = done
    a.onpause = done
    a.onerror = () => fail(new Error('audio playback failed'))
    a.play().catch(fail)
  })
}

function onceSettler(
  a: HTMLAudioElement,
  resolve: () => void,
  reject: (err: unknown) => void,
): { done: () => void; fail: (err: unknown) => void } {
  let settled = false
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
  return { done, fail }
}

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

export interface SpeakOptions {
  language?: string
  instruct?: string
}

async function fetchTts(text: string, opts: SpeakOptions, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(href('/api/speech/tts'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...opts }),
    signal,
  })
  if (!res.ok) throw new Error(`tts failed: ${await res.text().catch(() => res.status)}`)
  return res.blob()
}

export async function speak(
  text: string,
  opts: SpeakOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  await playBlob(await fetchTts(text, opts, signal))
}

export async function speakCard(cardId: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(href(`/api/cards/${encodeURIComponent(cardId)}/audio`), {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error(`audio failed: ${await res.text().catch(() => res.status)}`)
  await playBlob(await res.blob())
}

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
  try {
    await play(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface Speaker {
  push(text: string): void
  close(): Promise<void>
  cancel(): void
}

export function createSpeaker(opts: SpeakOptions = {}, onError?: (err: Error) => void): Speaker {
  const state = speakerState()
  const report = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e))
    if (onError) onError(err)
    else
      void import('./toast.svelte').then((m) => m.toast(`Playback failed: ${err.message}`, 'error'))
  }
  const started = runLoop(state, report)
  return speakerApi(state, started, opts)
}

interface SpeakerState {
  queue: { text: string; audio: Promise<Blob> }[]
  cancelled: boolean
  closed: boolean
  wake: (() => void) | null
}

function speakerState(): SpeakerState {
  return { queue: [], cancelled: false, closed: false, wake: null }
}

async function runLoop(state: SpeakerState, report: (e: unknown) => void): Promise<void> {
  while (!state.cancelled) {
    if (state.queue.length === 0) {
      if (state.closed) break
      await new Promise<void>((r) => (state.wake = r))
      continue
    }
    try {
      const blob = await state.queue.shift()!.audio
      if (state.cancelled) break
      await playBlob(blob)
    } catch (e) {
      report(e)
    }
  }
}

function signal(state: SpeakerState): void {
  if (!state.wake) return
  const r = state.wake
  state.wake = null
  r()
}

function speakerApi(state: SpeakerState, started: Promise<void>, opts: SpeakOptions): Speaker {
  return {
    push: (text) => pushText(state, opts, text),
    close: () => closeSpeaker(state, started),
    cancel: () => cancelSpeaker(state),
  }
}

const BRACKETED_READING =
  /[（(][^()（）]*[\u3100-\u312f\u02c7\u02ca\u02cb\u02d9āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ][^()（）]*[)）]|[（(][\u3040-\u309f\s]+[)）]/g

export function speakable(text: string): string {
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(BRACKETED_READING, '')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/\p{Extended_Pictographic}|\ufe0f|\u200d/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return /[\p{L}\p{N}]/u.test(plain) ? plain : ''
}

function pushText(state: SpeakerState, opts: SpeakOptions, text: string): void {
  const t = speakable(text)
  if (state.cancelled || state.closed || !t) return
  state.queue.push({ text: t, audio: fetchTts(t, opts) })
  signal(state)
}

async function closeSpeaker(state: SpeakerState, started: Promise<void>): Promise<void> {
  state.closed = true
  signal(state)
  await started
}

function cancelSpeaker(state: SpeakerState): void {
  state.cancelled = true
  state.closed = true
  for (const item of state.queue) item.audio.catch(() => {})
  state.queue.length = 0
  signal(state)
  stopAudio()
}

export async function transcribe(blob: Blob, language?: string): Promise<string> {
  const fd = new FormData()
  const name = blob.type.includes('wav') ? 'clip.wav' : 'clip.webm'
  fd.set('file', blob, name)
  if (language) fd.set('language', language)
  const res = await fetch(href('/api/speech/asr'), {
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
