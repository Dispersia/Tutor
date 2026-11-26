import type { UserId, DeckId, CardId } from '../ids'
import type { Db } from '../db/client'
import { getDeck, listCards, updateCard, updateDeckSettings, type ServerCard } from '../db/repo'
import type { PlannedCard, Planner } from './plan'
import { MIN_EXPLANATION } from './plan'
import type { DeckContext } from './context'
import { exampleField, verifiedSentence, type GrammarExample } from './exampleCards'
import { trackDeckJob } from './jobs'

const MIN_KNOWN = 2

const filling = new Set<CardId>()

type Deck = NonNullable<ReturnType<typeof getDeck>>

export function startGrammarExamples(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  planner: Planner,
  knownWords: string[],
): void {
  trackDeckJob(deckId, runExamples({ db, userId, deckId, planner, known: new Set(knownWords) }))
}

interface ExampleJob {
  db: Db
  userId: UserId
  deckId: DeckId
  planner: Planner
  known: Set<string>
}

async function runExamples(job: ExampleJob): Promise<void> {
  const deck = getDeck(job.db, job.deckId)
  const cards = listCards(job.db, job.userId, job.deckId)
  if (!deck) return
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!
    if (!card.payload?.example) await fillExample(job, deck, card)
    updateDeckSettings(job.db, job.deckId, { cursor: i + 1, buildTotal: cards.length })
  }
  updateDeckSettings(job.db, job.deckId, { building: false, cursor: cards.length })
}

async function fillExample(job: ExampleJob, deck: Deck, card: ServerCard): Promise<void> {
  if (job.known.size < MIN_KNOWN) return
  const example = await planExample(job, deck, card)
  if (!example) return
  updateCard(job.db, card.id, { payload: { ...card.payload, example } })
}

async function planExample(
  job: ExampleJob,
  deck: Deck,
  card: ServerCard,
): Promise<GrammarExample | undefined> {
  const sentence = await verifiedSentence({
    planner: job.planner,
    request: exampleRequest(job, deck, card),
    targetLang: deck.targetLang,
    future: new Set(),
    known: new Set([...job.known, card.back]),
    deck: deckContext(deck),
  })
  return sentence ? exampleField(sentence) : undefined
}

function deckContext(deck: Deck): DeckContext {
  return {
    instruction: '',
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    readingScript: deck.settings?.readingScript,
  }
}

export async function ensureGrammarExample(
  db: Db,
  userId: UserId,
  card: ServerCard,
  planner: Planner,
  knownWords: string[],
): Promise<ServerCard> {
  if (card.payload?.example || card.payload?.template !== 'grammar' || !card.deckId) return card
  const deck = getDeck(db, card.deckId)
  if (!deck) return card
  const known = new Set(knownWords)
  if (known.size < MIN_KNOWN) return card
  const example = await planExample({ db, userId, deckId: deck.id, planner, known }, deck, card)
  if (!example) return card
  const payload = { ...card.payload, example }
  updateCard(db, card.id, { payload })
  return { ...card, payload }
}

export function needsGrammarTeaching(card: ServerCard): boolean {
  if (card.payload?.template !== 'grammar') return false
  if (card.payload?.intro === true && !hasExplanation(card.payload)) return true
  return !card.payload?.example
}

export function fillGrammarTeaching(
  db: Db,
  userId: UserId,
  card: ServerCard,
  planner: Planner,
  knownWords: string[],
): void {
  if (filling.has(card.id)) return
  filling.add(card.id)
  void ensureGrammarTeaching(db, userId, card, planner, knownWords)
    .catch(() => {})
    .finally(() => filling.delete(card.id))
}

export async function ensureGrammarTeaching(
  db: Db,
  userId: UserId,
  card: ServerCard,
  planner: Planner,
  knownWords: string[],
): Promise<ServerCard> {
  const explained = await ensureGrammarExplanation(db, userId, card, planner, knownWords)
  return ensureGrammarExample(db, userId, explained, planner, knownWords)
}

export async function ensureGrammarExplanation(
  db: Db,
  userId: UserId,
  card: ServerCard,
  planner: Planner,
  knownWords: string[],
): Promise<ServerCard> {
  if (card.payload?.template !== 'grammar' || card.payload?.intro !== true) return card
  if (hasExplanation(card.payload) || !card.deckId) return card
  const deck = getDeck(db, card.deckId)
  if (!deck) return card
  const job = { db, userId, deckId: deck.id, planner, known: new Set(knownWords) }
  const explanation = await planExplanation(job, deck, card)
  if (!explanation) return card
  const payload = { ...card.payload, explanation }
  updateCard(db, card.id, { payload })
  return { ...card, payload }
}

function hasExplanation(payload: Record<string, unknown> | undefined): boolean {
  const text = typeof payload?.explanation === 'string' ? payload.explanation.trim() : ''
  return text.length >= MIN_EXPLANATION
}

async function planExplanation(
  job: ExampleJob,
  deck: Deck,
  card: ServerCard,
): Promise<string | undefined> {
  const planned = await job
    .planner(explanationRequest(job, deck, card))
    .catch(() => [] as PlannedCard[])
  const points = planned.filter((c) => c.template === 'grammar')
  const point = points.find((c) => c.back === card.back) ?? points[0]
  const text =
    typeof point?.payload?.explanation === 'string' ? point.payload.explanation.trim() : ''
  return text.length >= MIN_EXPLANATION ? text : undefined
}

function explanationRequest(job: ExampleJob, deck: Deck, card: ServerCard) {
  const instruction = [
    `${card.front}.`,
    'Teach this grammar point with exactly one grammar card.',
    'Its payload.explanation must say what it means, when each form is used, and the mistake learners make.',
  ].join(' ')
  return {
    instruction,
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    words: [card.back],
    knownWords: [...job.known],
    count: 1,
  }
}

function exampleRequest(job: ExampleJob, deck: Deck, card: ServerCard) {
  return {
    instruction: `${ruleOf(card)}. Write one short, natural sentence that shows this grammar point, using only the known words.`,
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    words: [card.back],
    knownWords: [...job.known],
    count: 1,
  }
}

function ruleOf(card: ServerCard): string {
  return typeof card.payload?.rule === 'string' ? card.payload.rule : card.front
}
