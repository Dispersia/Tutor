import type { UserId, DeckId } from '../ids'
import { getDeck, listCards, rememberedDeckInstruction, updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import { fetchFrequencyWords, frequencySourceFor } from '../frequency/source'
import type { Fetcher } from '../frequency/source'
import type { Planner } from './plan'
import type { Reviewer } from './review'
import { fillDeck } from './build'
import { maxStep, type BuiltDeck, type DeckContext, type GrowDeckOptions } from './context'
import type { DeckSettings } from './settings'
import { MAX_DECK_WORDS, PLAN_CHUNK, clamp } from './instruction'
import { lexiconOrder } from './lexicon'
import { startDeckBuild } from './jobs'

type Deck = NonNullable<ReturnType<typeof getDeck>>

export interface GrowthPlan {
  instruction: string
  ctx: DeckContext
  words: string[]
  knownWords: string[]
  startStep: number
  cursor: number
  cardCount: number
}

export async function growthPlan(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: GrowPlanOpts = {},
): Promise<GrowthPlan | undefined> {
  const head = await planHead(db, userId, deckId, opts)
  if (!head) return undefined
  const source = await sourceWordsFor(head, opts.fetcher)
  return planOf(head, source, instructionFor(db, userId, head.settings), opts.topic)
}

function planOf(head: PlanHead, source: string[], instruction: string, topic?: string): GrowthPlan {
  const known = new Set(head.known)
  return {
    instruction,
    ctx: growthContext(head.deck, head.settings, instruction, topic),
    words: source.slice(head.cursor).filter((w) => !known.has(w)),
    knownWords: head.known,
    startStep: maxStep(head.cards),
    cursor: head.cursor,
    cardCount: head.cards.length,
  }
}

function introducesWord(c: ReturnType<typeof listCards>[number]): boolean {
  const template = c.payload?.template
  if (template === undefined) return c.type === 'vocab'
  return template === 'vocab' || c.payload?.intro === true
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

async function planHead(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: GrowPlanOpts,
): Promise<PlanHead | undefined> {
  const deck = getDeck(db, deckId)
  if (!deck) return undefined
  const settings = deck.settings ?? {}
  const cards = listCards(db, userId, deckId)
  return {
    deck,
    settings,
    cards,
    known: cards.filter(introducesWord).map((c) => c.back),
    cursor: settings.cursor ?? 0,
    want: clamp(opts.want ?? PLAN_CHUNK, 1, MAX_DECK_WORDS),
  }
}

async function sourceWordsFor(head: PlanHead, fetcher?: Fetcher): Promise<string[]> {
  if (head.settings.words?.length) return head.settings.words
  const stored = lexiconOrder(head.deck.targetLang)
  if (stored?.length) return stored
  const { words } = await fetchFrequencyWords(head.deck.targetLang, {
    variant: head.settings.variant,
    fetcher,
    limit: clamp(head.cursor + head.want + 200, 300, MAX_DECK_WORDS),
  })
  return words.map((w) => w.word)
}

function instructionFor(db: Db, userId: UserId, settings: DeckSettings): string {
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
  return {
    instruction,
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    topic,
    variant: settings.variant,
    readingScript: settings.readingScript,
    pitchAccent: settings.pitchAccent,
    hints: settings.hints,
  }
}

export async function growDeck(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: GrowDeckOptions,
): Promise<BuiltDeck> {
  const deck = getDeck(db, deckId)
  if (!deck) throw new Error('deck not found')
  const settings = deck.settings ?? {}
  const count = clamp(opts.count ?? settings.batchSize ?? 10, 1, MAX_DECK_WORDS)
  const plan = await grownPlan(db, userId, deckId, opts, count)
  if (!plan) throw new Error('deck not found')
  const filled = await fillGrown(db, growFillInput(userId, deckId, plan, opts, count))
  updateDeckSettings(db, deckId, grownSettings(plan, count))
  return grewDeck(deck, settings, deckId, plan.cardCount + filled.cardCount, filled.newWords)
}

function growFillInput(
  userId: UserId,
  deckId: DeckId,
  plan: GrowthPlan,
  opts: GrowDeckOptions,
  count: number,
): GrowFill {
  return { userId, deckId, plan, count, planner: opts.planner, reviewer: opts.reviewer }
}

function grownPlan(db: Db, userId: UserId, deckId: DeckId, opts: GrowDeckOptions, count: number) {
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
  userId: UserId
  deckId: DeckId
  plan: GrowthPlan
  count: number
  planner: Planner
  reviewer?: Reviewer
}

function fillGrown(db: Db, req: GrowFill) {
  return fillDeck(db, req.userId, req.deckId, {
    ctx: req.plan.ctx,
    opts: {
      words: req.plan.words,
      count: req.count,
      knownWords: req.plan.knownWords,
      startStep: req.plan.startStep,
      reviewer: req.reviewer,
    },
    planner: req.planner,
  })
}

function grewDeck(
  deck: Deck,
  settings: DeckSettings,
  deckId: DeckId,
  cardCount: number,
  newWords: string[],
): BuiltDeck {
  const source =
    settings.wordSource === 'anki'
      ? 'uploaded deck'
      : (frequencySourceFor(deck.targetLang, settings.variant)?.label ?? deck.targetLang)
  return { deckId, name: deck.name, cardCount, source, newWords }
}

export async function startDeckGrowth(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: GrowStartOpts,
): Promise<number | undefined> {
  const plan = await growthPlan(db, userId, deckId, growthRequest(opts))
  if (!plan) return undefined
  const words = boundedWords(plan, opts.count)
  if (words.length === 0) return stopBuilding(db, deckId)
  const total = plan.cursor + words.length
  updateDeckSettings(db, deckId, buildingPatch(total))
  startDeckBuild(db, userId, deckId, growthJob(plan, words, opts, total))
  return words.length
}

function growthRequest(opts: GrowStartOpts) {
  return grownRequest(opts, opts.count ?? MAX_DECK_WORDS)
}

function boundedWords(plan: GrowthPlan, count?: number): string[] {
  return count ? plan.words.slice(0, count) : plan.words
}

function buildingPatch(total: number) {
  return { building: true, buildTotal: total, buildError: undefined }
}

function grownRequest(opts: GrowStartOpts, want: number) {
  return { topic: opts.topic, fetcher: opts.fetcher, want }
}

function stopBuilding(db: Db, deckId: DeckId): number {
  updateDeckSettings(db, deckId, { building: false, buildError: undefined })
  return 0
}

interface GrowStartOpts {
  topic?: string
  fetcher?: Fetcher
  planner: Planner
  count?: number
  reviewer?: Reviewer
  onFinish?: () => void
}

function growthJob(plan: GrowthPlan, words: string[], opts: GrowStartOpts, total: number) {
  return {
    ctx: plan.ctx,
    opts: {
      words,
      count: words.length,
      knownWords: plan.knownWords,
      startStep: plan.startStep,
      reviewer: opts.reviewer,
    },
    planner: opts.planner,
    base: { cursorStart: plan.cursor, total, onFinish: opts.onFinish },
  }
}
