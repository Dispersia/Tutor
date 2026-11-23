import { api } from './api'
import { apiPath } from './paths'
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

/** Settle a clip's promise at most once, however `play()` ends. */
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
  // `pause` fires when we stop playback mid-clip (stopAudio); resolve so callers
  // waiting on the clip do not hang forever.
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
  voice?: string
  language?: string
  mode?: 'preset' | 'design'
  /** Style cue sent to the TTS model (see TEACHER_INSTRUCT). */
  instruct?: string
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

/** Synthesises and plays one chunk of text via the local speech gateway. */
export async function speak(
  text: string,
  opts: SpeakOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  await playBlob(await fetchTts(text, opts, signal))
}

/**
 * Plays a card's pre-recorded audio. The server holds ten recorded voices per
 * card and hands back a random one per request, so a listening card never wakes
 * the TTS model; a card whose clips are still being recorded is synthesized and
 * cached on the server the first time it is played.
 */
export async function speakCard(cardId: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(apiPath(`/api/cards/${encodeURIComponent(cardId)}/audio`), {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error(`audio failed: ${await res.text().catch(() => res.status)}`)
  await playBlob(await res.blob())
}

/** Play a blob from an object URL, revoking it however playback ends. */
async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
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
  const state = speakerState()
  const report = (e: unknown) => onError?.(e instanceof Error ? e : new Error(String(e)))
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

/** Plays queued sentences in order, synthesising each while the last one plays. */
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

function pushText(state: SpeakerState, opts: SpeakOptions, text: string): void {
  const t = text.trim()
  if (state.cancelled || state.closed || !t) return
  const audio = fetchTts(t, opts)
  // If cancel() drops this item before the loop awaits it, the rejection must
  // not surface as an unhandled promise rejection.
  audio.catch(() => {})
  state.queue.push({ text: t, audio })
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
  state.queue.length = 0
  signal(state)
  stopAudio()
}

/** Transcribes a recorded clip with the local speech gateway. */
export async function transcribe(blob: Blob, language?: string): Promise<string> {
  const fd = new FormData()
  // Recorder hands us a trimmed 16 kHz WAV; keep the name honest for the gateway.
  const name = blob.type.includes('wav') ? 'clip.wav' : 'clip.webm'
  fd.set('file', blob, name)
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
