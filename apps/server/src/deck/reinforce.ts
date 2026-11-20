import type { Deps } from '../context'
import { addCard, getCard, getDeck, listCards } from '../db/repo'
import { leapsAhead } from './generate'
import { plannerFor } from './planner'
import type { PlannedCard } from './plan'

/** How many lapses before a word earns a reinforcement card. */
export const REINFORCE_LAPSES = 3

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
  if (!card?.deckId) return
  if (card.payload?.template !== 'vocab') return
  const step = card.payload?.step
  if (typeof step !== 'number') return

  const cards = listCards(deps.db, userId, card.deckId)
  if (cards.some((c) => c.payload?.reinforces === cardId)) return

  const deck = getDeck(deps.db, card.deckId, userId)
  if (!deck) return
  const settings = deck.settings ?? {}

  const introduced = (c: (typeof cards)[number], side: 'before' | 'after') => {
    const s = c.payload?.step
    if (c.payload?.template !== 'vocab' || typeof s !== 'number') return false
    return side === 'before' ? s < step : s > step
  }
  // Everything the learner has met before this word — the n+1 vocabulary.
  const knownWords = cards.filter((c) => introduced(c, 'before')).map((c) => c.back)
  // Everything still ahead — a card that reaches into it is a violation.
  const future = new Set(cards.filter((c) => introduced(c, 'after')).map((c) => c.back))

  const planner = await plannerFor(deps, userId)
  if (!planner) return

  const planned = await planner({
    instruction:
      settings.instruction ??
      'Add one extra card that practises the most recent word in a short, natural example.',
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    words: [card.back],
    knownWords,
    count: 1,
    variant: settings.variant,
    readingScript: settings.readingScript,
    pitchAccent: false,
  })
  const extra: PlannedCard | undefined = planned.find(
    (c) => c.template !== 'vocab' && !leapsAhead(c, future),
  )
  if (!extra?.back) return

  addCard(deps.db, userId, {
    deckId: card.deckId,
    type: (extra.template === 'grammar' ? 'grammar' : 'phrase') as never,
    sourceLang: deck.sourceLang,
    targetLang: deck.targetLang,
    front: extra.front,
    back: extra.back,
    readings: readingsFor(deck.targetLang, extra.reading),
    tags: [deck.targetLang, extra.template],
    payload: { ...(extra.payload ?? {}), template: extra.template, step, reinforces: cardId },
    metadata: extra.metadata as never,
    origin: 'llm',
  })
}
