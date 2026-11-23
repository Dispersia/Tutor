import type { Card } from '@tutor/core'
import type { Deps } from '../context'
import { addCard, getCard, getDeck, listCards } from '../db/repo'
import { leapsAhead } from './generate'
import { plannerFor } from './planner'
import type { PlannedCard, Planner } from './plan'

/** How many lapses before a word earns a reinforcement card. */
export const REINFORCE_LAPSES = 3

const DEFAULT_INSTRUCTION =
  'Add one extra card that practises the most recent word in a short, natural example.'

type Deck = NonNullable<ReturnType<typeof getDeck>>

function readingsFor(targetLang: string, reading: string | undefined): Record<string, string> {
  if (!reading) return {}
  if (targetLang === 'ja') return { kana: reading }
  if (targetLang === 'zh' || targetLang === 'yue') return { zhuyin: reading }
  return { reading }
}

/**
 * When a card keeps lapsing, grow the deck around it: ask the planner for one
 * extra sentence/grammar card that practises the same word using only words the
 * learner has already met (strict n+1), then add it to that word's lesson.
 *
 * Runs in the background after a review, so the learner never waits on it. At
 * most one reinforcement per card, ever — the new card carries
 * `payload.reinforces = <cardId>` and a second lapse is a no-op.
 */
export async function reinforceLapsedCard(
  deps: Deps,
  userId: string,
  cardId: string,
): Promise<void> {
  const card = getCard(deps.db, cardId, userId)
  if (!card?.deckId || card.payload?.template !== 'vocab') return
  const step = card.payload?.step
  if (typeof step !== 'number') return
  const cards = listCards(deps.db, userId, card.deckId)
  if (cards.some((c) => c.payload?.reinforces === cardId)) return
  const deck = getDeck(deps.db, card.deckId, userId)
  if (!deck) return
  const planner = await plannerFor(deps, userId)
  if (!planner) return
  const extra = await planExtra(planner, deck, card, step, cards)
  if (!extra) return
  persistExtra(deps, { deck, card, step, userId }, extra)
}

/** A word comes before the target when its lesson step is lower (and vice versa). */
function before(c: Card, step: number): boolean {
  return (
    c.payload?.template === 'vocab' && typeof c.payload?.step === 'number' && c.payload.step < step
  )
}

function after(c: Card, step: number): boolean {
  return (
    c.payload?.template === 'vocab' && typeof c.payload?.step === 'number' && c.payload.step > step
  )
}

/** One extra card that practises the word and reaches into no future word. */
async function planExtra(
  planner: Planner,
  deck: Deck,
  card: Card,
  step: number,
  cards: Card[],
): Promise<PlannedCard | undefined> {
  const planned = await planner(planReq(deck, card, step, cards))
  // Everything still ahead — a card that reaches into it is a violation.
  const future = new Set(cards.filter((c) => after(c, step)).map((c) => c.back))
  return planned.find((c) => c.template !== 'vocab' && !leapsAhead(c, future))
}

function planReq(deck: Deck, card: Card, step: number, cards: Card[]) {
  const settings = deck.settings ?? {}
  return {
    instruction: settings.instruction ?? DEFAULT_INSTRUCTION,
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    words: [card.back],
    // Everything the learner has met before this word — the n+1 vocabulary.
    knownWords: cards.filter((c) => before(c, step)).map((c) => c.back),
    count: 1,
    reinforce: true,
    variant: settings.variant,
    readingScript: settings.readingScript,
    pitchAccent: false,
  }
}

interface ReinforceTarget {
  deck: Deck
  card: Card
  step: number
  userId: string
}

/** Adds the planned card to the lapsed word's own lesson step. */
function persistExtra(deps: Deps, target: ReinforceTarget, extra: PlannedCard): void {
  const { deck, card, step, userId } = target
  addCard(deps.db, userId, {
    deckId: card.deckId!,
    type: (extra.template === 'grammar' ? 'grammar' : 'phrase') as never,
    sourceLang: deck.sourceLang,
    targetLang: deck.targetLang,
    front: extra.front,
    back: extra.back,
    readings: readingsFor(deck.targetLang, extra.reading),
    tags: [deck.targetLang, extra.template],
    payload: extraPayload(extra, card.id, step),
    metadata: extra.metadata as never,
    origin: 'llm',
  })
}

function extraPayload(extra: PlannedCard, cardId: string, step: number) {
  return { ...(extra.payload ?? {}), template: extra.template, step, reinforces: cardId }
}
