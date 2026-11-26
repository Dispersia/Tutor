import type { CardId } from '../ids'
import type { Card, CardMetadata, CardType, ExerciseContext } from '@tutor/core'
import type { PlannedCard, PlanRequest, Planner } from './plan'
import { storedTemplate } from './plan'
import { exampleFails, pruneDistractors, readingsForPlanned, type DeckContext } from './context'
import { verifyCard } from '../exercises/verify'

export interface GrammarExample {
  text: string
  gloss?: string
  reading?: string
}

export interface SentencePlan {
  planner: Planner
  request: PlanRequest
  targetLang: string
  future: ReadonlySet<string>
  known: Set<string>
  deck: DeckContext
}

export async function verifiedSentence(plan: SentencePlan): Promise<PlannedCard | undefined> {
  const planned = await plan.planner(plan.request).catch(() => [] as PlannedCard[])
  for (const card of planned) {
    if (card.template !== 'sentence') continue
    pruneDistractors(card, plan.future, plan.known)
    if (exampleFails(plan.targetLang, card, plan.future, plan.known)) continue
    const verdict = await verifyCard(verifyContext(asCard(card, plan.deck), plan.deck, plan.known))
    if (verdict.ok) return card
  }
  return undefined
}

export async function verifiedSentenceTwice(plan: SentencePlan): Promise<PlannedCard | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const card = await verifiedSentence(plan)
    if (card) return card
  }
  return undefined
}

export function exampleField(card: PlannedCard): GrammarExample {
  const gloss = typeof card.payload?.gloss === 'string' ? card.payload.gloss : undefined
  return { text: card.back, gloss, reading: card.reading }
}

export function verifyContext(card: Card, deck: DeckContext, known: Set<string>): ExerciseContext {
  const words = [...known, card.back]
  return {
    card,
    learner: { id: '', nativeLang: deck.sourceLang, targetLang: deck.targetLang, level: '' },
    distractors: [],
    readings: {},
    known: words,
    seen: words,
    showReadings: false,
  }
}

export function asCard(card: PlannedCard, deck: DeckContext): Card {
  const template = storedTemplate(card)
  return {
    id: '' as CardId,
    deckId: null,
    type: cardType(template),
    sourceLang: deck.sourceLang,
    targetLang: deck.targetLang,
    front: card.front,
    back: card.back,
    readings: readingsForPlanned(deck.targetLang, card.reading, deck.readingScript, card.back),
    tags: [deck.targetLang, template],
    payload: { ...(card.payload ?? {}), template },
    metadata: (card.metadata ?? {}) as CardMetadata,
    origin: 'llm',
    createdAt: Date.now(),
  }
}

function cardType(template: PlannedCard['template']): CardType {
  if (template === 'sentence') return 'phrase'
  if (template === 'grammar') return 'grammar'
  return 'vocab'
}
