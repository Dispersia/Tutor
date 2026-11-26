import { expect, test } from 'bun:test'
import type { DeckId } from '../ids'
import { awaitDeckBuild, claimDeck, isDeckBuilding, releaseDeck, trackDeckJob } from './builds'

test('a claimed deck refuses a second claim until it is released', () => {
  const deckId = 'deck-claim' as DeckId
  expect(claimDeck(deckId)).toBe(true)
  expect(isDeckBuilding(deckId)).toBe(true)
  expect(claimDeck(deckId)).toBe(false)
  releaseDeck(deckId)
  expect(claimDeck(deckId)).toBe(true)
  releaseDeck(deckId)
  expect(isDeckBuilding(deckId)).toBe(false)
})

test('a tracked build keeps the deck busy until it settles', async () => {
  const deckId = 'deck-track' as DeckId
  let finish!: () => void
  trackDeckJob(
    deckId,
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  expect(isDeckBuilding(deckId)).toBe(true)
  expect(claimDeck(deckId)).toBe(false)
  finish()
  await awaitDeckBuild(deckId)
  await Promise.resolve()
  expect(isDeckBuilding(deckId)).toBe(false)
})

test('a failed build still frees the deck', async () => {
  const deckId = 'deck-fail' as DeckId
  trackDeckJob(deckId, Promise.reject(new Error('boom')))
  await awaitDeckBuild(deckId)
  await Promise.resolve()
  expect(isDeckBuilding(deckId)).toBe(false)
})
