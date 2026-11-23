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
      const res = await fetch(`${sup.url}/v1/tts`, {
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
    } finally {
      sup.end()
    }
  }
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

export function createAudioService(opts: {
  db: Db
  dataDir: string
  tts: TtsFn
}): AudioService {
  const { db, dataDir, tts } = opts
  const pending: AudioJob[] = []
  const queued = new Set<string>()
  let running = false
  let current: string | null = null
  let recorded = 0
  let failed = 0

  const keyOf = (j: AudioJob) => `${j.language}\u0000${j.text}`

  function complete(text: string): boolean {
    return CARD_VOICES.every((v) => hasClip(db, dataDir, clipHash(text, v.id)))
  }

  function clip(text: string, voiceId: string): Uint8Array | undefined {
    return readClip(db, dataDir, clipHash(text, voiceId))
  }

  async function ensureVoice(
    text: string,
    language: string,
    userId: string,
    voiceId: string,
  ): Promise<void> {
    const voice = CARD_VOICES.find((v) => v.id === voiceId)
    if (!voice) throw new Error(`unknown voice ${voiceId}`)
    const hash = clipHash(text, voice.id)
    if (hasClip(db, dataDir, hash)) return
    const bytes = await tts({
      text,
      language,
      instruct: voice.instruct,
      mode: 'design',
      normalize: true,
    })
    if (bytes.length === 0) throw new Error('tts produced no audio')
    writeClip(db, dataDir, userId, hash, bytes)
  }

  async function ensure(text: string, language: string, userId: string): Promise<void> {
    for (const v of CARD_VOICES) await ensureVoice(text, language, userId, v.id)
  }

  function enqueue(jobs: AudioJob[]): number {
    let added = 0
    for (const j of jobs) {
      if (!j.text.trim()) continue
      const key = keyOf(j)
      if (queued.has(key)) continue
      if (complete(j.text)) continue
      queued.add(key)
      pending.push(j)
      added++
    }
    void pump()
    return added
  }

  function enqueueDeck(userId: string, deckId: string): void {
    const cards = listCards(db, userId, deckId)
    enqueue(cards.map((c: Card) => ({ userId, text: c.back, language: c.targetLang })))
  }

  function enqueueUser(userId: string): number {
    const cards = listCards(db, userId)
    return enqueue(cards.map((c: Card) => ({ userId, text: c.back, language: c.targetLang })))
  }

  function cancel(): number {
    const n = pending.length
    pending.length = 0
    queued.clear()
    return n
  }

  async function pump(): Promise<void> {
    if (running) return
    running = true
    try {
      while (pending.length > 0) {
        const job = pending.shift()!
        current = job.text
        try {
          await ensure(job.text, job.language, job.userId)
          recorded++
        } catch (err) {
          failed++
          console.error('[audio] recording failed:', (err as Error).message)
        } finally {
          queued.delete(keyOf(job))
          current = null
        }
      }
    } finally {
      running = false
    }
  }

  return {
    voices: CARD_VOICES,
    complete,
    clip,
    ensureVoice,
    ensure,
    enqueue,
    enqueueDeck,
    enqueueUser,
    cancel,
    status: () => ({
      pending: pending.length,
      running,
      current,
      recorded,
      failed,
      voices: CARD_VOICES.length,
    }),
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
