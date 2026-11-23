/** Growing an existing deck: its next batch and the background finish. */

import { getDeck, listCards, rememberedDeckInstruction, updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import { fetchFrequencyWords, frequencySourceFor } from '../frequency/source'
import type { Fetcher } from '../frequency/source'
import type { Planner } from './plan'
import { fillDeck } from './build'
import { maxStep, type BuiltDeck, type DeckContext, type GrowDeckOptions } from './context'
import type { DeckSettings } from './settings'
import { MAX_DECK_WORDS, PLAN_CHUNK, clamp } from './instruction'
import { startDeckBuild } from './jobs'

type Deck = NonNullable<ReturnType<typeof getDeck>>

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
  opts: GrowPlanOpts = {},
): Promise<GrowthPlan | undefined> {
  const head = await planHead(db, userId, deckId, opts)
  if (!head) return undefined
  const source = await sourceWordsFor(head, opts.fetcher)
  return planOf(head, source, instructionFor(db, userId, head.settings), opts.topic)
}

function planOf(head: PlanHead, source: string[], instruction: string, topic?: string): GrowthPlan {
  return {
    instruction,
    ctx: growthContext(head.deck, head.settings, instruction, topic),
    words: source.slice(head.cursor).filter((w) => !head.known.includes(w)),
    knownWords: head.known,
    startStep: maxStep(head.cards),
    cursor: head.cursor,
  }
}

interface GrowPlanOpts {
  topic?: string
  fetcher?: Fetcher
  want?: number
}

interface PlanHead {
  deck: Deck
  settings: DeckSettings
  cards: ReturnType<typeof listCards>
  known: string[]
  cursor: number
  want: number
}

/** The deck, its settings and n+1 state, or undefined when it does not exist. */
async function planHead(
  db: Db,
  userId: string,
  deckId: string,
  opts: GrowPlanOpts,
): Promise<PlanHead | undefined> {
  const deck = getDeck(db, deckId, userId)
  if (!deck) return undefined
  const settings = deck.settings ?? {}
  const cards = listCards(db, userId, deckId)
  return {
    deck,
    settings,
    cards,
    known: cards.map((c) => c.back),
    cursor: settings.cursor ?? 0,
    want: clamp(opts.want ?? PLAN_CHUNK, 1, MAX_DECK_WORDS),
  }
}

/** The deck's stored word list, or a freshly pulled frequency list. */
async function sourceWordsFor(head: PlanHead, fetcher?: Fetcher): Promise<string[]> {
  if (head.settings.words?.length) return head.settings.words
  const { words } = await fetchFrequencyWords(head.deck.targetLang, {
    variant: head.settings.variant,
    fetcher,
    limit: clamp(head.cursor + head.want + 200, 300, MAX_DECK_WORDS),
  })
  return words.map((w) => w.word)
}

/**
 * A deck's own prompt wins. Older imported decks only carry the generic "Build a
 * deck from the imported deck …" wording, so they pick up the learner's
 * remembered prompt instead of losing it on the next batch.
 */
function instructionFor(db: Db, userId: string, settings: DeckSettings): string {
  const generic =
    !settings.instruction || settings.instruction.startsWith('Build a deck from the imported deck ')
  return generic
    ? (rememberedDeckInstruction(db, userId) ?? settings.instruction ?? 'Continue the deck')
    : (settings.instruction ?? 'Continue the deck')
}

function growthContext(
  deck: Deck,
  settings: DeckSettings,
  instruction: string,
  topic?: string,
): DeckContext {
  // The prompt that built the deck stays in force for every later batch; a topic
  // narrows the batch without replacing the learner's rules.
  return {
    instruction,
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    topic,
    variant: settings.variant,
    readingScript: settings.readingScript,
    pitchAccent: settings.pitchAccent,
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
  const plan = await grownPlan(db, userId, deckId, opts, count)
  if (!plan) throw new Error('deck not found')
  const filled = await fillGrown(db, { userId, deckId, plan, count, planner: opts.planner })
  updateDeckSettings(db, deckId, userId, grownSettings(plan, count))
  return grewDeck(deck, settings, deckId, cards.length + filled.cardCount, filled.newWords)
}

function grownPlan(db: Db, userId: string, deckId: string, opts: GrowDeckOptions, count: number) {
  return growthPlan(db, userId, deckId, {
    topic: opts.topic,
    fetcher: opts.fetcher,
    want: count,
  })
}

function grownSettings(plan: GrowthPlan, count: number) {
  return {
    cursor: plan.cursor + count,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: plan.instruction,
    buildError: undefined,
  }
}

interface GrowFill {
  userId: string
  deckId: string
  plan: GrowthPlan
  count: number
  planner: Planner
}

function fillGrown(db: Db, req: GrowFill) {
  return fillDeck(db, req.userId, req.deckId, {
    ctx: req.plan.ctx,
    opts: {
      words: req.plan.words,
      count: req.count,
      knownWords: req.plan.knownWords,
      startStep: req.plan.startStep,
    },
    planner: req.planner,
  })
}

function grewDeck(
  deck: Deck,
  settings: DeckSettings,
  deckId: string,
  cardCount: number,
  newWords: string[],
): BuiltDeck {
  const source =
    settings.wordSource === 'anki'
      ? 'uploaded deck'
      : (frequencySourceFor(deck.targetLang, settings.variant)?.label ?? deck.targetLang)
  return { deckId, name: deck.name, cardCount, source, newWords }
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
  opts: GrowStartOpts,
): Promise<number | undefined> {
  const plan = await growthPlan(db, userId, deckId, grownRequest(opts, MAX_DECK_WORDS))
  if (!plan) return undefined
  if (plan.words.length === 0) return stopBuilding(db, deckId, userId)
  const total = plan.cursor + plan.words.length
  updateDeckSettings(db, deckId, userId, {
    building: true,
    buildTotal: total,
    buildError: undefined,
  })
  startDeckBuild(db, userId, deckId, growthJob(plan, opts, total))
  return plan.words.length
}

function grownRequest(opts: GrowStartOpts, want: number) {
  return { topic: opts.topic, fetcher: opts.fetcher, want }
}

function stopBuilding(db: Db, deckId: string, userId: string): number {
  updateDeckSettings(db, deckId, userId, { building: false, buildError: undefined })
  return 0
}

interface GrowStartOpts {
  topic?: string
  fetcher?: Fetcher
  planner: Planner
  onFinish?: () => void
}

function growthJob(plan: GrowthPlan, opts: GrowStartOpts, total: number) {
  return {
    ctx: plan.ctx,
    opts: {
      words: plan.words,
      count: plan.words.length,
      knownWords: plan.knownWords,
      startStep: plan.startStep,
    },
    planner: opts.planner,
    base: { cursorStart: plan.cursor, total, onFinish: opts.onFinish },
  }
}
