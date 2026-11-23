/** Creating and filling a deck from an instruction (the synchronous path). */

import { createDeck, updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import { fetchFrequencyWords, frequencySourceFor } from '../frequency/source'
import type { PlannedCard, Planner } from './plan'
import type { DeckSettings } from './settings'
import {
  applyDictionaryPitch,
  applyDictionaryReading,
  contextFrom,
  persistCards,
  type BuildDeckOptions,
  type BuiltDeck,
  type DeckContext,
} from './context'
import { DEFAULT_COUNT, MAX_DECK_WORDS, PLAN_CHUNK, clamp } from './instruction'

export interface CreateDeckResult {
  deckId: string
  name: string
  /** The ordered words the deck will introduce. */
  candidates: string[]
  /** The provenance label, e.g. "uploaded deck" or the frequency source. */
  sourceLabel: string
  /** How many words the caller asked for (already clamped). */
  count: number
}

/** Where a deck's words came from, and how many to introduce. */
interface WordSource {
  candidates: string[]
  label: string
  kind: 'frequency' | 'anki'
}

/**
 * Creates the deck and stores its rules without generating a single card. The
 * synchronous build fills it right away; an import can return this to the
 * learner at once and then fill it in the background.
 */
export async function createDeckForBuild(
  db: Db,
  userId: string,
  opts: BuildDeckOptions,
): Promise<CreateDeckResult> {
  const count = clamp(opts.count ?? DEFAULT_COUNT, 1, MAX_DECK_WORDS)
  const source = await resolveWords(opts, count)
  const name = opts.name?.trim() || `${opts.topic ?? opts.targetLang} · generated`
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Generated from ${source.label}`,
    settings: deckSettings(opts, count, source),
  })
  return { deckId: deck.id, name, candidates: source.candidates, sourceLabel: source.label, count }
}

/** The words come either from an imported deck or from a pulled frequency list. */
async function resolveWords(opts: BuildDeckOptions, count: number): Promise<WordSource> {
  if (opts.words?.length) {
    return { candidates: opts.words, label: opts.sourceLabel ?? 'uploaded deck', kind: 'anki' }
  }
  const source = frequencySourceFor(opts.targetLang, opts.variant)
  if (!source) throw new Error(`no frequency list for language "${opts.targetLang}"`)
  const { words } = await fetchFrequencyWords(opts.targetLang, {
    variant: opts.variant,
    fetcher: opts.fetcher,
    source,
    limit: clamp(count + 200, 300, MAX_DECK_WORDS),
  })
  return { candidates: words.map((w) => w.word), label: source.label, kind: 'frequency' }
}

function deckSettings(opts: BuildDeckOptions, count: number, source: WordSource): DeckSettings {
  return {
    variant: opts.variant,
    readingScript: opts.readingScript,
    showReadings: opts.showReadings,
    disabledExercises: opts.disabledExercises,
    pitchAccent: opts.pitchAccent,
    cursor: 0,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: opts.instruction,
    wordSource: source.kind,
    // keep the source list so an imported deck can keep growing without it
    words: source.kind === 'anki' ? source.candidates.slice(0, MAX_DECK_WORDS) : undefined,
  }
}

export interface FillDeckOptions {
  /** The words to introduce, in order (frequency order or the deck's own). */
  words: string[]
  /** How many of them to introduce (≤ words.length). */
  count: number
  /** Words already in the deck, so example cards stay n+1. */
  knownWords?: string[]
  /** The n+1 step to continue from. */
  startStep?: number
  /** Called after every batch with (words introduced, total requested). */
  onProgress?: (built: number, total: number) => void
}

export interface FillDeckResult {
  newWords: string[]
  cardCount: number
  /** How many words were actually introduced. */
  built: number
}

/** One fill run: the deck's rules, the words to introduce and the planner. */
export interface FillDeckRequest {
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
}

/** The batch loop's running state. */
interface FillState {
  known: string[]
  /** Words waiting to be introduced, so no card reaches ahead (strict n+1). */
  future: Set<string>
  newWords: string[]
  cardCount: number
  step: number
  built: number
  chunkSize: number
}

function fillState(opts: FillDeckOptions): FillState {
  const known = [...(opts.knownWords ?? [])]
  const future = new Set(opts.words)
  for (const w of known) future.delete(w)
  return {
    known,
    future,
    newWords: [],
    cardCount: 0,
    step: opts.startStep ?? 0,
    built: 0,
    chunkSize: PLAN_CHUNK,
  }
}

/**
 * Plans and persists a deck's cards in {@link PLAN_CHUNK}-word batches. Each
 * batch carries the words already introduced, so the planner's sentence and
 * grammar cards only ever use what the learner has met. Persisting batch by
 * batch means a long build is durable: an interrupted import keeps what it made.
 *
 * A batch whose JSON came back truncated (the model hit its output cap) is
 * retried with half the words, down to a single word — the build shrinks around
 * a fussy batch rather than giving up on the whole deck, then widens again.
 */
export async function fillDeck(
  db: Db,
  userId: string,
  deckId: string,
  request: FillDeckRequest,
): Promise<FillDeckResult> {
  const { ctx, opts, planner } = request
  const total = clamp(opts.count, 0, opts.words.length)
  const state = fillState(opts)
  const batchReq: BatchReq = { db, userId, deckId, ctx, opts, planner, state, total }
  while (state.built < total) await oneBatch(batchReq)
  return { newWords: state.newWords, cardCount: state.cardCount, built: state.built }
}

interface BatchReq {
  db: Db
  userId: string
  deckId: string
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
  state: FillState
  total: number
}

/** Plans and persists one batch, shrinking the next size after a truncation. */
async function oneBatch(req: BatchReq) {
  const { state, total } = req
  const size = Math.min(state.chunkSize, total - state.built)
  const words = req.opts.words.slice(state.built, state.built + size)
  const planned = await planChunk(req.planner, req.ctx, words, state, size)
  if (!planned) {
    state.chunkSize = Math.max(1, Math.floor(size / 2))
    return
  }
  const res = persistBatch({
    db: req.db,
    userId: req.userId,
    deckId: req.deckId,
    ctx: req.ctx,
    planned,
    state,
  })
  accumulate(state, res, size, total, req.opts)
}

/** Plans one batch; undefined when it failed and should be retried smaller. */
async function planChunk(
  planner: Planner,
  ctx: DeckContext,
  words: string[],
  state: FillState,
  size: number,
): Promise<PlannedCard[] | undefined> {
  try {
    return await planner(planArgs(ctx, words, state, size))
  } catch (err) {
    // Retry the same words with a smaller batch. A single word that still fails
    // is a real error — stop there, keeping everything already made.
    if (size > 1) return undefined
    throw err
  }
}

function planArgs(ctx: DeckContext, words: string[], state: FillState, size: number) {
  return {
    instruction: ctx.instruction,
    targetLang: ctx.targetLang,
    sourceLang: ctx.sourceLang,
    topic: ctx.topic,
    words,
    knownWords: state.known.slice(),
    variant: ctx.variant,
    readingScript: ctx.readingScript,
    count: size,
    pitchAccent: ctx.pitchAccent,
    hints: ctx.hints,
  }
}

interface PersistReq {
  db: Db
  userId: string
  deckId: string
  ctx: DeckContext
  planned: PlannedCard[]
  state: FillState
}

function persistBatch(req: PersistReq) {
  const { ctx, planned, state } = req
  applyDictionaryPitch(ctx.targetLang, ctx.pitchAccent, planned)
  applyDictionaryReading(ctx.targetLang, ctx.readingScript, ctx.hints, planned)
  return persistCards(
    req.db,
    req.userId,
    req.deckId,
    {
      targetLang: ctx.targetLang,
      sourceLang: ctx.sourceLang,
      readingScript: ctx.readingScript,
      startStep: state.step,
      futureWords: state.future,
    },
    planned,
  )
}

function accumulate(
  state: FillState,
  res: ReturnType<typeof persistCards>,
  size: number,
  total: number,
  opts: FillDeckOptions,
): void {
  state.step += res.newWords.length
  state.known.push(...res.newWords)
  state.newWords.push(...res.newWords)
  state.cardCount += res.cardCount
  state.built += size
  opts.onProgress?.(state.built, total)
  // Recover the batch size one word at a time after a shrink.
  if (state.chunkSize < PLAN_CHUNK) state.chunkSize = Math.min(PLAN_CHUNK, state.chunkSize + 1)
}

/**
 * Builds a new deck from an instruction: pulls a frequency list, generates its
 * cards (n+1), and stores the deck with its own settings. Synchronous — the
 * import path uses {@link startDeckBuild} so the learner is not left waiting.
 */
export async function buildDeck(
  db: Db,
  userId: string,
  opts: BuildDeckOptions,
): Promise<BuiltDeck> {
  const created = await createDeckForBuild(db, userId, opts)
  const { newWords, cardCount, built } = await fillDeck(db, userId, created.deckId, {
    ctx: contextFrom(opts),
    opts: { words: created.candidates, count: created.count, knownWords: [], startStep: 0 },
    planner: opts.planner,
  })
  updateDeckSettings(db, created.deckId, userId, { cursor: built })
  return {
    deckId: created.deckId,
    name: created.name,
    cardCount,
    source: created.sourceLabel,
    newWords,
  }
}
