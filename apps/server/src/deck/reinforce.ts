import type { UserId, CardId } from '../ids'
import type { Card } from '@tutor/core'
import type { Deps } from '../context'
import {
  addCard,
  getCard,
  getDeck,
  getUserSetting,
  listCards,
  setUserSetting,
  type ServerCard,
} from '../db/repo'
import { applyDictionaryReading, leapsAhead, readingsForPlanned } from './context'
import { plannerFor } from './planner'
import type { PlannedCard, Planner } from './plan'

export const REINFORCE_LAPSES = 3

const DEFAULT_INSTRUCTION =
  'Add one extra card that practises the most recent word in a short, natural example.'

type Deck = NonNullable<ReturnType<typeof getDeck>>

const ATTEMPTS_KEY = 'reinforce.tried'
const RETRY_AFTER_MS = 86_400_000

export async function reinforceLapsedCard(
  deps: Deps,
  userId: UserId,
  cardId: CardId,
): Promise<void> {
  const card = getCard(deps.db, cardId, userId)
  if (!card?.deckId || card.payload?.template !== 'vocab') return
  const step = card.payload?.step
  if (typeof step !== 'number' || triedRecently(deps, userId, cardId)) return
  const cards = listCards(deps.db, userId, card.deckId)
  if (isReinforced(cards, cardId)) return
  const deck = getDeck(deps.db, card.deckId)
  if (!deck) return
  const planner = await plannerFor(deps, userId)
  if (!planner || !claimAttempt(deps, userId, cardId)) return
  const extra = await planExtra(planner, deck, card, step, cards)
  if (!extra || isReinforced(listCards(deps.db, userId, card.deckId), cardId)) return
  persistExtra(deps, { deck, card, step, userId }, extra)
}

function isReinforced(cards: Card[], cardId: CardId): boolean {
  return cards.some((c) => c.payload?.reinforces === cardId)
}

function attempts(deps: Deps, userId: UserId): Record<string, number> {
  try {
    return JSON.parse(getUserSetting(deps.db, userId, ATTEMPTS_KEY) || '{}') as Record<
      string,
      number
    >
  } catch {
    return {}
  }
}

function triedRecently(deps: Deps, userId: UserId, cardId: CardId): boolean {
  return Date.now() - (attempts(deps, userId)[cardId] ?? 0) < RETRY_AFTER_MS
}

function claimAttempt(deps: Deps, userId: UserId, cardId: CardId): boolean {
  if (triedRecently(deps, userId, cardId)) return false
  const next = { ...attempts(deps, userId), [cardId]: Date.now() }
  setUserSetting(deps.db, userId, ATTEMPTS_KEY, JSON.stringify(next))
  return true
}

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

async function planExtra(
  planner: Planner,
  deck: Deck,
  card: Card,
  step: number,
  cards: Card[],
): Promise<PlannedCard | undefined> {
  const planned = await planner(planReq(deck, card, step, cards))
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
  card: ServerCard
  step: number
  userId: UserId
}

function persistExtra(deps: Deps, target: ReinforceTarget, extra: PlannedCard): void {
  const { deck, card, step, userId } = target
  const script = deck.settings?.readingScript
  applyDictionaryReading(deck.targetLang, script, undefined, [extra])
  addCard(deps.db, userId, {
    deckId: card.deckId!,
    type: (extra.template === 'grammar' ? 'grammar' : 'phrase') as never,
    sourceLang: deck.sourceLang,
    targetLang: deck.targetLang,
    front: extra.front,
    back: extra.back,
    readings: readingsForPlanned(deck.targetLang, extra.reading, script, extra.back),
    tags: [deck.targetLang, extra.template],
    payload: extraPayload(extra, card.id, step),
    metadata: extra.metadata as never,
    origin: 'llm',
    privateTo: userId,
  })
}

function extraPayload(extra: PlannedCard, cardId: CardId, step: number) {
  return { ...(extra.payload ?? {}), template: extra.template, step, reinforces: cardId }
}
