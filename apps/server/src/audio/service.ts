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

import { toUserId, type UserId, type DeckId } from '../ids'
import { voiceInstruct, type Card } from '@tutor/core'
import type { Db } from '../db/client'
import { cardLanguages, listCards } from '../db/repo'
import { withGateway } from '../speech/gateway'
import type { SpeechSupervisor } from '../speech/supervisor'
import {
  clipHash,
  findClip,
  hasClip,
  legacyClipHash,
  readClip,
  removeClip,
  writeClip,
} from './store'
import { saysExactly } from './verify'
import { CARD_VOICES, voiceAt, type CardVoice } from './voices'

export interface TtsRequest {
  text: string
  language?: string
  instruct?: string
  /** Peak-normalise the clip (card audio); chat playback leaves it off. */
  normalize?: boolean
}

/** Synthesizes one clip. Injected so tests run without the MLX gateway. */
export type TtsFn = (req: TtsRequest) => Promise<Uint8Array>

/**
 * Transcribes a clip, so a recording can be graded before it is kept.
 * `reference` is the expected text: the gateway uses it only to return Chinese
 * in the same script, never to bias what it hears.
 */
export type AsrFn = (clip: Uint8Array, language: string, reference: string) => Promise<string>

/** The real recogniser: POST the gateway's `/v1/asr` through the supervisor. */
export function gatewayAsr(sup: SpeechSupervisor): AsrFn {
  return (clip, language, reference) =>
    withGateway(sup, (url) => postAsr(url, { clip, language, reference }))
}

async function postAsr(
  url: string,
  req: { clip: Uint8Array; language: string; reference: string },
): Promise<string> {
  const form = new FormData()
  form.set('file', new Blob([req.clip as unknown as BlobPart], { type: 'audio/wav' }), 'clip.wav')
  form.set('language', req.language)
  form.set('reference', req.reference)
  const signal = AbortSignal.timeout(60_000)
  const res = await fetch(`${url}/v1/asr`, { method: 'POST', body: form, signal })
  if (!res.ok) throw new Error(`asr -> ${res.status}: ${await res.text().catch(() => '')}`)
  return ((await res.json()) as { text?: string }).text ?? ''
}

/** The real TTS: POST the gateway's `/v1/tts` through the supervisor, so the
 * request keeps the sidecar alive and counts against its idle timer. */
export function gatewayTts(sup: SpeechSupervisor): TtsFn {
  return (req) => withGateway(sup, (url) => postTts(url, req))
}

async function postTts(url: string, req: TtsRequest): Promise<Uint8Array> {
  const res = await fetch(`${url}/v1/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: req.text,
      language: req.language,
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
  userId: UserId
  text: string
  language: string
  /** The card's kana reading. Used only to grade the clip, never to synthesise it. */
  kana?: string
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
  /** Clips thrown away because every take said something other than the text. */
  rejected: number
  /** Voices recorded per card. */
  voices: number
}

export interface AudioService {
  readonly voices: readonly CardVoice[]
  /** True when every voice for this text, in this language, is on disk. */
  complete(text: string, language: string): boolean
  /** Reads one recorded clip, or undefined when it is missing. */
  clip(text: string, language: string, voiceId: string): Uint8Array | undefined
  /** Records one voice for a text (no-op when already recorded). */
  ensureVoice(job: AudioJob & { voiceId: string }): Promise<void>
  /** Records every voice for a text. */
  ensure(job: AudioJob): Promise<void>
  /** Queues texts in the background; duplicates and complete ones are skipped.
   * Returns how many new jobs were added. */
  enqueue(jobs: AudioJob[]): number
  /** Queues every card of a deck that is missing clips. */
  enqueueDeck(userId: UserId, deckId: DeckId): void
  /** Queues every card the user owns. */
  enqueueUser(userId: UserId): number
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
  /** Clip keys no take passed for; not retried until the next restart. */
  rejected: Set<string>
}

/** Everything the recording helpers read, threaded as a parameter. */
interface AudioStore {
  db: Db
  dataDir: string
  tts: TtsFn
  /** Absent in tests and tools that record without grading. */
  asr?: AsrFn
  q: QueueState
}

export interface AudioServiceOptions {
  db: Db
  dataDir: string
  tts: TtsFn
  /** When given, every clip is transcribed and kept only if it says its text. */
  asr?: AsrFn
}

export function createAudioService(opts: AudioServiceOptions): AudioService {
  const store: AudioStore = { ...opts, q: emptyQueue() }
  return service(store)
}

function emptyQueue(): QueueState {
  return {
    pending: [],
    queued: new Set(),
    running: false,
    current: null,
    recorded: 0,
    failed: 0,
    rejected: new Set(),
  }
}

/** The public surface, closing over the store the helpers read. */
function service(store: AudioStore): AudioService {
  return {
    voices: CARD_VOICES,
    complete: (text, language) => complete(store, text, language),
    clip: (text, language, voiceId) =>
      readClip(store.db, store.dataDir, clipKey(store, { text, language, voiceId })),
    ensureVoice: (job) => ensureVoice(store, job),
    ensure: (job) => ensureText(store, job),
    enqueue: (jobs) => enqueue(store, jobs),
    enqueueDeck: (userId, deckId) => enqueueDeck(store, userId, deckId),
    enqueueUser: (userId) => enqueueUser(store, userId),
    cancel: () => cancel(store),
    status: () => status(store),
  }
}

const keyOf = (j: AudioJob): string => `${j.language}\u0000${j.text}`

/** Nothing left to record: every voice is on disk, or was given up on. */
function complete(s: AudioStore, text: string, language: string): boolean {
  return CARD_VOICES.every((v) => {
    const hash = clipKey(s, { text, language, voiceId: v.id })
    return hasClip(s.db, s.dataDir, hash) || s.q.rejected.has(hash)
  })
}

/** One voice's clip of a text in a language. */
interface ClipRef {
  text: string
  language: string
  voiceId: string
}

/** The clip's storage key, first adopting a pre-language recording if one fits. */
function clipKey(s: AudioStore, ref: ClipRef): string {
  const hash = clipHash(ref.text, ref.voiceId, ref.language)
  if (!hasClip(s.db, s.dataDir, hash)) adoptLegacyClip(s, ref, hash)
  return hash
}

/**
 * Clips used to be keyed without the language, so a word two languages share
 * played whichever was recorded first. An old clip is moved to its language's
 * key only when this is the **only** language any card uses the text in — then
 * it can only have been recorded for it. A shared text is ambiguous: its old
 * clip is dropped and each language records its own.
 */
function adoptLegacyClip(s: AudioStore, ref: ClipRef, hash: string): void {
  const legacy = legacyClipHash(ref.text, ref.voiceId)
  const bytes = readClip(s.db, s.dataDir, legacy)
  if (!bytes) return
  const languages = cardLanguages(s.db, ref.text)
  if (languages.every((l) => l === ref.language)) {
    writeClip(s.db, s.dataDir, clipOwner(s, legacy), hash, bytes)
  }
  removeClip(s.db, s.dataDir, legacy)
}

function clipOwner(s: AudioStore, hash: string): UserId {
  return findClip(s.db, hash)?.userId ?? toUserId('')
}

type VoiceJob = AudioJob & { voiceId: string }

async function ensureVoice(s: AudioStore, job: VoiceJob): Promise<void> {
  const voice = CARD_VOICES.find((v) => v.id === job.voiceId)
  if (!voice) throw new Error(`unknown voice ${job.voiceId}`)
  const hash = clipKey(s, job)
  if (hasClip(s.db, s.dataDir, hash) || s.q.rejected.has(hash)) return
  const bytes = await recordGraded(s, job, voice)
  if (bytes) writeClip(s.db, s.dataDir, job.userId, hash, bytes)
  else s.q.rejected.add(hash)
}

/** How many takes a clip gets before it is given up on. */
const TAKES = 3

/**
 * Records a clip and grades it: the recogniser must hear the card's text and
 * nothing else. The model is random per take, so a bad take is simply retried;
 * undefined when no take passed (a missing clip beats a wrong one).
 */
async function recordGraded(
  s: AudioStore,
  job: VoiceJob,
  voice: CardVoice,
): Promise<Uint8Array | undefined> {
  for (let take = 1; take <= TAKES; take++) {
    const bytes = await s.tts({
      // The model has no language switch: the accent rides in the description.
      text: job.text,
      language: job.language,
      instruct: voiceInstruct(voice.instruct, job.language),
      normalize: true,
    })
    if (bytes.length === 0) throw new Error('tts produced no audio')
    if (!s.asr) return bytes
    const heard = await s.asr(bytes, job.language, job.text)
    if (saysExactly(job, heard)) return bytes
    console.warn(`[audio] take ${take}/${TAKES} of "${job.text}" (${voice.id}) said "${heard}"`)
  }
  return undefined
}

async function ensureText(s: AudioStore, job: AudioJob): Promise<void> {
  for (const v of CARD_VOICES) await ensureVoice(s, { ...job, voiceId: v.id })
}

function enqueue(s: AudioStore, jobs: AudioJob[]): number {
  let added = 0
  for (const j of jobs) {
    if (!j.text.trim()) continue
    const key = keyOf(j)
    if (s.q.queued.has(key) || complete(s, j.text, j.language)) continue
    s.q.queued.add(key)
    s.q.pending.push(j)
    added++
  }
  void pump(s)
  return added
}

function enqueueCards(s: AudioStore, cards: Card[], userId: UserId): number {
  return enqueue(
    s,
    cards.map((c) => ({ userId, text: c.back, language: c.targetLang, kana: c.readings.kana })),
  )
}

function enqueueDeck(s: AudioStore, userId: UserId, deckId: DeckId): void {
  enqueueCards(s, listCards(s.db, userId, deckId), userId)
}

function enqueueUser(s: AudioStore, userId: UserId): number {
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
    rejected: s.q.rejected.size,
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
    await ensureText(s, job)
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
