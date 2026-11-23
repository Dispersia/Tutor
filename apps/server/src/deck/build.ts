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

  // The words come either from an imported deck or from a pulled frequency list.
  let candidates: string[]
  let sourceLabel: string
  let wordSource: 'frequency' | 'anki'
  if (opts.words?.length) {
    candidates = opts.words
    sourceLabel = opts.sourceLabel ?? 'uploaded deck'
    wordSource = 'anki'
  } else {
    const source = frequencySourceFor(opts.targetLang, opts.variant)
    if (!source) throw new Error(`no frequency list for language "${opts.targetLang}"`)
    const { words } = await fetchFrequencyWords(opts.targetLang, {
      variant: opts.variant,
      fetcher: opts.fetcher,
      source,
      limit: clamp(count + 200, 300, MAX_DECK_WORDS),
    })
    candidates = words.map((w) => w.word)
    sourceLabel = source.label
    wordSource = 'frequency'
  }

  const settings: DeckSettings = {
    variant: opts.variant,
    readingScript: opts.readingScript,
    showReadings: opts.showReadings,
    disabledExercises: opts.disabledExercises,
    pitchAccent: opts.pitchAccent,
    cursor: 0,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: opts.instruction,
    wordSource,
    // keep the source list so an imported deck can keep growing without it
    words: wordSource === 'anki' ? candidates.slice(0, MAX_DECK_WORDS) : undefined,
  }
  const name = opts.name?.trim() || `${opts.topic ?? opts.targetLang} · generated`
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Generated from ${sourceLabel}`,
    settings,
  })
  return { deckId: deck.id, name, candidates, sourceLabel, count }
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
/** One fill run: the deck's rules, the words to introduce and the planner. */
export interface FillDeckRequest {
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
}

export async function fillDeck(
  db: Db,
  userId: string,
  deckId: string,
  request: FillDeckRequest,
): Promise<FillDeckResult> {
  const { ctx, opts, planner } = request
  const total = clamp(opts.count, 0, opts.words.length)
  const known = [...(opts.knownWords ?? [])]
  // Words still waiting to be introduced, shared across batches so a card can
  // never reach ahead to a word a later batch will teach (strict n+1).
  const future = new Set(opts.words)
  for (const w of known) future.delete(w)
  const newWords: string[] = []
  let cardCount = 0
  let step = opts.startStep ?? 0
  let built = 0
  let chunkSize = PLAN_CHUNK

  while (built < total) {
    const size = Math.min(chunkSize, total - built)
    const chunk = opts.words.slice(built, built + size)
    let planned: PlannedCard[]
    try {
      planned = await planner({
        instruction: ctx.instruction,
        targetLang: ctx.targetLang,
        sourceLang: ctx.sourceLang,
        topic: ctx.topic,
        words: chunk,
        knownWords: known.slice(),
        variant: ctx.variant,
        readingScript: ctx.readingScript,
        count: size,
        pitchAccent: ctx.pitchAccent,
        hints: ctx.hints,
      })
    } catch (err) {
      // Retry the same words with a smaller batch. A single word that still
      // fails is a real error — stop there, keeping everything already made.
      if (size > 1) {
        chunkSize = Math.max(1, Math.floor(size / 2))
        continue
      }
      throw err
    }
    applyDictionaryPitch(ctx.targetLang, ctx.pitchAccent, planned)
    applyDictionaryReading(ctx.targetLang, ctx.readingScript, ctx.hints, planned)
    const res = persistCards(
      db,
      userId,
      deckId,
      {
        targetLang: ctx.targetLang,
        sourceLang: ctx.sourceLang,
        readingScript: ctx.readingScript,
        startStep: step,
        futureWords: future,
      },
      planned,
    )
    step += res.newWords.length
    known.push(...res.newWords)
    newWords.push(...res.newWords)
    cardCount += res.cardCount
    built += size
    opts.onProgress?.(built, total)
    // Recover the batch size one word at a time after a shrink.
    if (chunkSize < PLAN_CHUNK) chunkSize = Math.min(PLAN_CHUNK, chunkSize + 1)
  }
  return { newWords, cardCount, built }
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
