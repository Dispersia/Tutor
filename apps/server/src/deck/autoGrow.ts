import type { UserId, DeckId } from '../ids'
import type { Deps } from '../context'
import { getDeck, listCards, listSrs } from '../db/repo'
import { isPath, PATH_AHEAD, PATH_BATCH } from './path'
import { startDeckGrowth } from './growth'
import { lexiconOrder } from './lexicon'
import { plannerFor, reviewerFor } from './planner'
import { claimDeck, isDeckBuilding, releaseDeck } from './builds'

export function maybeAutoGrow(deps: Deps, userId: UserId, card: { deckId?: DeckId | null }): void {
  const deckId = card.deckId
  if (!deckId) return
  const deck = getDeck(deps.db, deckId)
  if (!deck || !isPath(deck.settings.kind) || deck.settings.autoGrow === false) return
  if (deck.settings.building || isDeckBuilding(deckId)) return
  if (!hasMore(deck.settings, deck.targetLang)) return
  if (unseenCards(deps, userId, deckId) > PATH_AHEAD) return
  if (!claimDeck(deckId)) return
  void growPath(deps, userId, deckId, deck.settings.batchWords ?? PATH_BATCH).finally(() =>
    releaseDeck(deckId),
  )
}

function hasMore(settings: { words?: string[]; cursor?: number }, lang: string): boolean {
  const words = settings.words ?? lexiconOrder(lang)
  if (!words) return true
  return (settings.cursor ?? 0) < words.length
}

function unseenCards(deps: Deps, userId: UserId, deckId: DeckId): number {
  const seen = new Set(listSrs(deps.db, userId).map((row) => row.cardId))
  return listCards(deps.db, userId, deckId).filter((card) => !seen.has(card.id)).length
}

async function growPath(deps: Deps, userId: UserId, deckId: DeckId, count: number): Promise<void> {
  const planner = await plannerFor(deps, userId)
  if (!planner) return
  const reviewer = await reviewerFor(deps, userId)
  await startDeckGrowth(deps.db, userId, deckId, {
    count,
    fetcher: deps.fetcher,
    planner,
    reviewer,
    onFinish: () => deps.audio?.enqueueDeck(userId, deckId),
  })
}
