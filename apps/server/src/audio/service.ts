import { toUserId, type UserId, type DeckId } from '../ids'
import { voiceInstruct, type Card } from '@tutor/core'
import type { Db } from '../db/client'
import { cardLanguages, listCards } from '../db/repo'
import { isUtterance } from '../exercises/payload'
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
  normalize?: boolean
}

export type TtsFn = (req: TtsRequest) => Promise<Uint8Array>

export type AsrFn = (clip: Uint8Array, language: string, reference: string) => Promise<string>

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
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`tts -> ${res.status}: ${await res.text().catch(() => '')}`)
  return new Uint8Array(await res.arrayBuffer())
}

interface AudioJob {
  userId: UserId
  text: string
  language: string
  kana?: string
}

export const AUDIO_BACKFILL_KEY = 'audio.backfill'

interface AudioStatus {
  pending: number
  running: boolean
  current: string | null
  recorded: number
  failed: number
  rejected: number
  voices: number
}

export interface AudioService {
  readonly voices: readonly CardVoice[]
  complete(text: string, language: string): boolean
  clip(text: string, language: string, voiceId: string): Uint8Array | undefined
  ensureVoice(job: AudioJob & { voiceId: string }): Promise<void>
  ensure(job: AudioJob): Promise<void>
  enqueue(jobs: AudioJob[]): number
  enqueueDeck(userId: UserId, deckId: DeckId): void
  enqueueUser(userId: UserId): number
  cancel(): number
  status(): AudioStatus
}

interface QueueState {
  pending: AudioJob[]
  queued: Set<string>
  running: boolean
  current: string | null
  recorded: number
  failed: number
  rejected: Set<string>
}

interface AudioStore {
  db: Db
  dataDir: string
  tts: TtsFn
  asr?: AsrFn
  q: QueueState
}

export interface AudioServiceOptions {
  db: Db
  dataDir: string
  tts: TtsFn
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

function complete(s: AudioStore, text: string, language: string): boolean {
  return CARD_VOICES.every((v) => {
    const hash = clipKey(s, { text, language, voiceId: v.id })
    return hasClip(s.db, s.dataDir, hash) || s.q.rejected.has(hash)
  })
}

interface ClipRef {
  text: string
  language: string
  voiceId: string
}

function clipKey(s: AudioStore, ref: ClipRef): string {
  const hash = clipHash(ref.text, ref.voiceId, ref.language)
  if (!hasClip(s.db, s.dataDir, hash)) adoptLegacyClip(s, ref, hash)
  return hash
}

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

const TAKES = 3

async function recordGraded(
  s: AudioStore,
  job: VoiceJob,
  voice: CardVoice,
): Promise<Uint8Array | undefined> {
  for (let take = 1; take <= TAKES; take++) {
    const bytes = await s.tts({
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
    cards
      .filter(isUtterance)
      .map((c) => ({ userId, text: c.back, language: c.targetLang, kana: c.readings.kana })),
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

export function variantVoice(variant: string | undefined): CardVoice {
  if (variant === undefined || variant === '') {
    return voiceAt(Math.floor(Math.random() * CARD_VOICES.length))
  }
  const n = Number(variant)
  return voiceAt(Number.isFinite(n) ? n : 0)
}
