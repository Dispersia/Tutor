import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { createUser, listCards, listDecks } from '../db/repo'
import { seedStarterDecks } from './service'

test('seeding gives a user the HSK 1 and JLPT N5 decks, once', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })

  expect(seedStarterDecks(db, user.id)).toBe(true)
  const decks = listDecks(db, user.id)
  expect(decks.map((d) => d.name).sort()).toEqual(['HSK 1', 'JLPT N5'])
  const total = decks.reduce((n, d) => n + Number(d.cardCount), 0)
  expect(total).toBeGreaterThan(100)

  // idempotent: seeding again is a no-op
  expect(seedStarterDecks(db, user.id)).toBe(false)
  expect(listDecks(db, user.id).length).toBe(2)

  // cards carry readings in the right key
  const hsk = decks.find((d) => d.name === 'HSK 1')!
  const cards = listCards(db, user.id, hsk.id)
  expect(cards[0]!.readings.pinyin).toBeTruthy()
  sqlite.close()
})

test('each user gets their own copy', () => {
  const { db, sqlite } = openDb(':memory:')
  const a = createUser(db, { username: 'a', passwordHash: 'x' })
  const b = createUser(db, { username: 'b', passwordHash: 'x' })
  seedStarterDecks(db, a.id)
  seedStarterDecks(db, b.id)
  expect(listCards(db, a.id).length).toBe(listCards(db, b.id).length)
  expect(listDecks(db, a.id)[0]!.id).not.toBe(listDecks(db, b.id)[0]!.id)
  sqlite.close()
})
