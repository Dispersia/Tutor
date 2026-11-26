import type { DeckId } from '../ids'

const builds = new Map<DeckId, Promise<void>>()
const claims = new Set<DeckId>()

const noop = () => undefined

export function isDeckBuilding(deckId: DeckId): boolean {
  return builds.has(deckId) || claims.has(deckId)
}

export function claimDeck(deckId: DeckId): boolean {
  if (isDeckBuilding(deckId)) return false
  claims.add(deckId)
  return true
}

export function releaseDeck(deckId: DeckId): void {
  claims.delete(deckId)
}

export function awaitDeckBuild(deckId: DeckId): Promise<void> {
  return builds.get(deckId) ?? Promise.resolve()
}

export function trackDeckJob(deckId: DeckId, run: Promise<unknown>): void {
  const tracked = run.then(noop, noop)
  builds.set(deckId, tracked)
  void tracked.finally(() => {
    if (builds.get(deckId) === tracked) builds.delete(deckId)
  })
}
