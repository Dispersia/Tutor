/**
 * Pre-recorded card audio (the listening exercise's source of truth).
 *
 * When a card is created it should already have a clip for every voice in
 * {@link CARD_VOICES}, so the "Play" button on a listening card is a plain
 * file stream instead of a fresh TTS call. Generation is slow (~1s per clip ×
 * four voices), so it runs through an in-process queue that keeps the speech
 * gateway warm and never blocks a request; a clip that is still missing is
 * synthesized once on demand and then cached forever.
 *
 * The queue is deliberately serial: the MLX gateway holds one inference lock, so
 * parallel requests would only queue anyway — and serializing keeps a long
 * backfill from starving a learner's playback of the clip they actually asked
 * for (it waits at most one short clip).
 */

import type { Card } from '@tutor/core'
import type { Db } from '../db/client'
import { listCards } from '../db/repo'
import type { SpeechSupervisor } from '../speech/supervisor'
import { clipHash, hasClip, readClip, writeClip } from './store'
import { CARD_VOICES, voiceAt, type CardVoice } from './voices'

export interface TtsRequest {
  text: string
  language?: string
  instruct?: string
  mode?: 'preset' | 'design'
  /** Peak-normalise the clip (card audio); chat playback leaves it off. */
  normalize?: boolean
}

/** Synthesizes one clip. Injected so tests run without the MLX gateway. */
export type TtsFn = (req: TtsRequest) => Promise<Uint8Array>

/** The real TTS: POST the gateway's `/v1/tts` through the supervisor, so the
 * request keeps the sidecar alive and counts against its idle timer. */
export function gatewayTts(sup: SpeechSupervisor): TtsFn {
  return async (req) => {
    await sup.ensure()
    sup.begin()
    try {
      return await postTts(sup.url, req)
    } finally {
      sup.end()
    }
  }
}

async function postTts(url: string, req: TtsRequest): Promise<Uint8Array> {
  const res = await fetch(`${url}/v1/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: req.text,
      language: req.language,
      mode: req.mode ?? 'design',
      instruct: req.instruct,
      normalize: req.normalize ?? false,
    }),
    // A gateway that dies mid-request must not stall the queue forever.
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`tts -> ${res.status}: ${await res.text().catch(() => '')}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** One text to record, plus the language the TTS model should assume. */
export interface AudioJob {
  userId: string
  text: string
  language: string
}

/**
 * Server-global flag: when set, every boot re-queues the whole library. A full
 * backfill runs for hours, and the queue is in-process, so without this a server
 * restart (a rebuild, a crash) would silently abandon it. `POST /api/audio/cancel`
 * clears it.
 */
export const AUDIO_BACKFILL_KEY = 'audio.backfill'

export interface AudioStatus {
  /** Jobs waiting behind the current one. */
  pending: number
  running: boolean
  /** The text currently being recorded, if any. */
  current: string | null
  /** Clips stored since this process started. */
  recorded: number
  /** Failed attempts (a later run retries them). */
  failed: number
  /** Voices recorded per card. */
  voices: number
}

export interface AudioService {
  readonly voices: readonly CardVoice[]
  /** True when every voice for this text is on disk. */
  complete(text: string): boolean
  /** Reads one recorded clip, or undefined when it is missing. */
  clip(text: string, voiceId: string): Uint8Array | undefined
  /** Records one voice for a text (no-op when already recorded). */
  ensureVoice(text: string, language: string, userId: string, voiceId: string): Promise<void>
  /** Records every voice for a text. */
  ensure(text: string, language: string, userId: string): Promise<void>
  /** Queues texts in the background; duplicates and complete ones are skipped.
   * Returns how many new jobs were added. */
  enqueue(jobs: AudioJob[]): number
  /** Queues every card of a deck that is missing clips. */
  enqueueDeck(userId: string, deckId: string): void
  /** Queues every card the user owns. */
  enqueueUser(userId: string): number
  /** Drops everything still queued; the clip being recorded finishes. Returns
   * how many jobs were dropped. */
  cancel(): number
  status(): AudioStatus
}

/** The in-process recording queue's mutable state. */
interface QueueState {
  pending: AudioJob[]
  queued: Set<string>
  running: boolean
  current: string | null
  recorded: number
  failed: number
}

/** Everything the recording helpers read, threaded as a parameter. */
interface AudioStore {
  db: Db
  dataDir: string
  tts: TtsFn
  q: QueueState
}

export function createAudioService(opts: { db: Db; dataDir: string; tts: TtsFn }): AudioService {
  const store: AudioStore = {
    db: opts.db,
    dataDir: opts.dataDir,
    tts: opts.tts,
    q: emptyQueue(),
  }
  return service(store)
}

function emptyQueue(): QueueState {
  return { pending: [], queued: new Set(), running: false, current: null, recorded: 0, failed: 0 }
}

/** The public surface, closing over the store the helpers read. */
function service(store: AudioStore): AudioService {
  return {
    voices: CARD_VOICES,
    complete: (text) => complete(store, text),
    clip: (text, voiceId) => readClip(store.db, store.dataDir, clipHash(text, voiceId)),
    ensureVoice: (text, language, userId, voiceId) =>
      ensureVoice(store, { text, language, userId, voiceId }),
    ensure: (text, language, userId) => ensureText(store, text, language, userId),
    enqueue: (jobs) => enqueue(store, jobs),
    enqueueDeck: (userId, deckId) => enqueueDeck(store, userId, deckId),
    enqueueUser: (userId) => enqueueUser(store, userId),
    cancel: () => cancel(store),
    status: () => status(store),
  }
}

const keyOf = (j: AudioJob): string => `${j.language}\u0000${j.text}`

function complete(s: AudioStore, text: string): boolean {
  return CARD_VOICES.every((v) => hasClip(s.db, s.dataDir, clipHash(text, v.id)))
}

interface VoiceJob {
  text: string
  language: string
  userId: string
  voiceId: string
}

async function ensureVoice(s: AudioStore, job: VoiceJob): Promise<void> {
  const voice = CARD_VOICES.find((v) => v.id === job.voiceId)
  if (!voice) throw new Error(`unknown voice ${job.voiceId}`)
  const hash = clipHash(job.text, voice.id)
  if (hasClip(s.db, s.dataDir, hash)) return
  const bytes = await s.tts({
    text: job.text,
    language: job.language,
    instruct: voice.instruct,
    mode: 'design',
    normalize: true,
  })
  if (bytes.length === 0) throw new Error('tts produced no audio')
  writeClip(s.db, s.dataDir, job.userId, hash, bytes)
}

async function ensureText(
  s: AudioStore,
  text: string,
  language: string,
  userId: string,
): Promise<void> {
  for (const v of CARD_VOICES) await ensureVoice(s, { text, language, userId, voiceId: v.id })
}

function enqueue(s: AudioStore, jobs: AudioJob[]): number {
  let added = 0
  for (const j of jobs) {
    if (!j.text.trim()) continue
    const key = keyOf(j)
    if (s.q.queued.has(key) || complete(s, j.text)) continue
    s.q.queued.add(key)
    s.q.pending.push(j)
    added++
  }
  void pump(s)
  return added
}

function enqueueCards(s: AudioStore, cards: Card[], userId: string): number {
  return enqueue(
    s,
    cards.map((c) => ({ userId, text: c.back, language: c.targetLang })),
  )
}

function enqueueDeck(s: AudioStore, userId: string, deckId: string): void {
  enqueueCards(s, listCards(s.db, userId, deckId), userId)
}

function enqueueUser(s: AudioStore, userId: string): number {
  return enqueueCards(s, listCards(s.db, userId), userId)
}

function cancel(s: AudioStore): number {
  const n = s.q.pending.length
  s.q.pending.length = 0
  s.q.queued.clear()
  return n
}

function status(s: AudioStore): AudioStatus {
  return {
    pending: s.q.pending.length,
    running: s.q.running,
    current: s.q.current,
    recorded: s.q.recorded,
    failed: s.q.failed,
    voices: CARD_VOICES.length,
  }
}

async function pump(s: AudioStore): Promise<void> {
  if (s.q.running) return
  s.q.running = true
  try {
    while (s.q.pending.length > 0) await runJob(s, s.q.pending.shift()!)
  } finally {
    s.q.running = false
  }
}

async function runJob(s: AudioStore, job: AudioJob): Promise<void> {
  s.q.current = job.text
  try {
    await ensureText(s, job.text, job.language, job.userId)
    s.q.recorded++
  } catch (err) {
    s.q.failed++
    console.error('[audio] recording failed:', (err as Error).message)
  } finally {
    s.q.queued.delete(keyOf(job))
    s.q.current = null
  }
}

/** Picks the voice a play request should use (`variant` may be absent). */
export function variantVoice(variant: string | undefined): CardVoice {
  if (variant === undefined || variant === '') {
    return voiceAt(Math.floor(Math.random() * CARD_VOICES.length))
  }
  const n = Number(variant)
  return voiceAt(Number.isFinite(n) ? n : 0)
}
