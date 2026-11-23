/** Growing an existing deck: its next batch and the background finish. */

import {
  getDeck,
  listCards,
  rememberedDeckInstruction,
  updateDeckSettings,
} from '../db/repo'
import type { Db } from '../db/client'
import { fetchFrequencyWords, frequencySourceFor } from '../frequency/source'
import type { Fetcher } from '../frequency/source'
import type { Planner } from './plan'
import { fillDeck } from './build'
import { maxStep, type BuiltDeck, type DeckContext, type GrowDeckOptions } from './context'
import { MAX_DECK_WORDS, PLAN_CHUNK, clamp } from './instruction'
import { startDeckBuild } from './jobs'

/** The words, rules and n+1 state one organic growth run works from. */
export interface GrowthPlan {
  instruction: string
  ctx: DeckContext
  /** The words still to introduce, in order. */
  words: string[]
  /** Words already in the deck, so example cards stay n+1. */
  knownWords: string[]
  /** The n+1 step to continue from. */
  startStep: number
  /** The index into the deck's source list this growth starts at. */
  cursor: number
}

/**
 * Reads a deck's next growth batch: its remaining words, its rules and the n+1
 * state to carry forward. An imported deck grows from its stored word list; a
 * frequency deck re-pulls `want` words' worth (plus headroom).
 */
export async function growthPlan(
  db: Db,
  userId: string,
  deckId: string,
  opts: { topic?: string; fetcher?: Fetcher; want?: number } = {},
): Promise<GrowthPlan | undefined> {
  const deck = getDeck(db, deckId, userId)
  if (!deck) return undefined
  const settings = deck.settings ?? {}
  const cards = listCards(db, userId, deckId)
  const known = cards.map((c) => c.back)
  const cursor = settings.cursor ?? 0
  const want = clamp(opts.want ?? PLAN_CHUNK, 1, MAX_DECK_WORDS)

  let sourceWords: string[]
  if (settings.words?.length) {
    sourceWords = settings.words
  } else {
    const { words } = await fetchFrequencyWords(deck.targetLang, {
      variant: settings.variant,
      fetcher: opts.fetcher,
      limit: clamp(cursor + want + 200, 300, MAX_DECK_WORDS),
    })
    sourceWords = words.map((w) => w.word)
  }
  const remaining = sourceWords.slice(cursor).filter((w) => !known.includes(w))

  // A deck's own prompt wins. Older imported decks only carry the generic
  // "Build a deck from the imported deck …" wording, so they pick up the
  // learner's remembered prompt instead of losing it on the next batch.
  const genericPrompt =
    !settings.instruction || settings.instruction.startsWith('Build a deck from the imported deck ')
  const instruction = genericPrompt
    ? (rememberedDeckInstruction(db, userId) ?? settings.instruction ?? 'Continue the deck')
    : (settings.instruction ?? 'Continue the deck')

  return {
    instruction,
    ctx: {
      // The prompt that built the deck stays in force for every later batch; a
      // topic narrows the batch without replacing the learner's rules.
      instruction,
      targetLang: deck.targetLang,
      sourceLang: deck.sourceLang,
      topic: opts.topic,
      variant: settings.variant,
      readingScript: settings.readingScript,
      pitchAccent: settings.pitchAccent,
    },
    words: remaining,
    knownWords: known,
    startStep: maxStep(cards),
    cursor,
  }
}

/**
 * Grows a deck organically: adds another n+1 batch from its frequency list (or
 * its stored word list). `topic` narrows the batch to a theme (e.g. a
 * restaurant). Synchronous — {@link startDeckGrowth} finishes it in the
 * background instead.
 */
export async function growDeck(
  db: Db,
  userId: string,
  deckId: string,
  opts: GrowDeckOptions,
): Promise<BuiltDeck> {
  const deck = getDeck(db, deckId, userId)
  if (!deck) throw new Error('deck not found')
  const settings = deck.settings ?? {}
  const cards = listCards(db, userId, deckId)
  const count = clamp(opts.count ?? settings.batchSize ?? 10, 1, MAX_DECK_WORDS)
  const plan = await growthPlan(db, userId, deckId, {
    topic: opts.topic,
    fetcher: opts.fetcher,
    want: count,
  })
  if (!plan) throw new Error('deck not found')

  const { newWords, cardCount } = await fillDeck(db, userId, deckId, {
    ctx: plan.ctx,
    opts: {
      words: plan.words,
      count,
      knownWords: plan.knownWords,
      startStep: plan.startStep,
    },
    planner: opts.planner,
  })
  updateDeckSettings(db, deckId, userId, {
    cursor: plan.cursor + count,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: plan.instruction,
    buildError: undefined,
  })
  return {
    deckId,
    name: deck.name,
    cardCount: cards.length + cardCount,
    source:
      settings.wordSource === 'anki'
        ? 'uploaded deck'
        : (frequencySourceFor(deck.targetLang, settings.variant)?.label ?? deck.targetLang),
    newWords,
  }
}

/**
 * Finishes a deck in the background: introduces every remaining word so an
 * interrupted or stopped build resumes with one action. Returns how many words
 * were left (0 when the deck was already complete).
 */
export async function startDeckGrowth(
  db: Db,
  userId: string,
  deckId: string,
  opts: { topic?: string; fetcher?: Fetcher; planner: Planner; onFinish?: () => void },
): Promise<number | undefined> {
  const plan = await growthPlan(db, userId, deckId, {
    topic: opts.topic,
    fetcher: opts.fetcher,
    want: MAX_DECK_WORDS,
  })
  if (!plan) return undefined
  if (plan.words.length === 0) {
    updateDeckSettings(db, deckId, userId, { building: false, buildError: undefined })
    return 0
  }
  const total = plan.cursor + plan.words.length
  updateDeckSettings(db, deckId, userId, {
    building: true,
    buildTotal: total,
    buildError: undefined,
  })
  startDeckBuild(db, userId, deckId, {
    ctx: plan.ctx,
    opts: {
      words: plan.words,
      count: plan.words.length,
      knownWords: plan.knownWords,
      startStep: plan.startStep,
    },
    planner: opts.planner,
    base: { cursorStart: plan.cursor, total, onFinish: opts.onFinish },
  })
  return plan.words.length
}
