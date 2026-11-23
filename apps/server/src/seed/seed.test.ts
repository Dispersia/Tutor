import { toUserId, toDeckId, toCardId } from '../ids'
import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { openDb } from '../db/client'
import {
  createUser,
  deleteUser,
  listCards,
  listDecks,
  setUserSetting,
  updateCard,
} from '../db/repo'
import { cards, decks } from '../db/schema'
import { reconcileStarterDecks, seedStarterDecks } from './service'

test('seeding gives a user the Mandarin and Japanese frequency decks, once', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })

  expect(seedStarterDecks(db, user.id)).toBe(true)
  const decks = listDecks(db)
  expect(decks.map((d) => d.name).sort()).toEqual(['Japanese · Frequency', 'Mandarin · Frequency'])
  expect(decks.map((d) => d.level).sort()).toEqual(['jafreq', 'zhfreq'])
  const total = decks.reduce((n, d) => n + Number(d.cardCount), 0)
  expect(total).toBeGreaterThan(200)

  // idempotent: seeding again is a no-op
  expect(seedStarterDecks(db, user.id)).toBe(false)
  expect(listDecks(db).length).toBe(2)

  // Mandarin cards carry Zhuyin only: no pinyin
  const zh = decks.find((d) => d.level === 'zhfreq')!
  const zhCards = listCards(db, user.id, zh.id)
  expect(zhCards[0]!.back).toBe('我')
  expect(zhCards[0]!.readings.zhuyin).toBe('ㄨㄛˇ')
  expect(zhCards[0]!.readings.pinyin).toBeUndefined()
  expect(zhCards[0]!.payload.pos).toBe('pron')

  // Japanese cards carry kana (furigana); no romaji is stored or shown
  const ja = decks.find((d) => d.level === 'jafreq')!
  const jaCards = listCards(db, user.id, ja.id)
  const kanji = jaCards.find((c) => c.back === '先生')!
  expect(kanji.readings.kana).toBe('せんせい')
  expect(kanji.readings.romaji).toBeUndefined()
  sqlite.close()
})

test('reconcile repairs stale curated cards in place (Simplified -> Traditional)', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'old', passwordHash: 'x' })
  seedStarterDecks(db, user.id)
  const zh = listDecks(db).find((d) => d.level === 'zhfreq')!
  const before = listCards(db, user.id, zh.id)
  const rice = before.find((c) => c.back === '米飯')!

  // Simulate the pre-2658b58 copy: Simplified hanzi + Latin pinyin readings.
  updateCard(db, rice.id, { back: '米饭', readings: { pinyin: 'mǐ fàn' } })
  setUserSetting(db, user.id, 'seedVersion', '1') // mark as an older seed

  reconcileStarterDecks(db, user.id)

  const after = listCards(db, user.id, zh.id).find((c) => c.id === rice.id)!
  expect(after.back).toBe('米飯')
  expect(after.readings.zhuyin).toBeTruthy()
  expect(after.readings.pinyin).toBeUndefined()
  // repaired in place: same id (SRS history kept), no duplicated cards
  expect(listCards(db, user.id, zh.id).length).toBe(before.length)
  sqlite.close()
})

test('reconcile gives an existing user a deck they never received', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'old2', passwordHash: 'x' })
  seedStarterDecks(db, user.id)

  // Drop the Japanese deck, as if this account was seeded before it existed.
  const ja = listDecks(db).find((d) => d.level === 'jafreq')!
  db.delete(cards).where(eq(cards.deckId, ja.id)).run()
  db.delete(decks).where(eq(decks.id, ja.id)).run()
  setUserSetting(db, user.id, 'seedVersion', '1')

  reconcileStarterDecks(db, user.id)

  const recreated = listDecks(db).find((d) => d.level === 'jafreq')
  expect(recreated).toBeTruthy()
  expect(listCards(db, user.id, recreated!.id).length).toBeGreaterThan(80)
  sqlite.close()
})

test('reconcile drops the retired themed decks', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'old3', passwordHash: 'x' })
  seedStarterDecks(db, user.id)
  // Simulate a leftover HSK 1 deck from an older seed.
  const legacy = db
    .insert(decks)
    .values({
      id: toDeckId('legacy-hsk'),
      userId: user.id,
      name: 'HSK 1',
      sourceLang: 'en',
      targetLang: 'zh',
      level: 'hsk1',
      description: 'old',
    })
    .returning()
    .get()
  db.insert(cards)
    .values({
      id: toCardId('legacy-card'),
      deckId: legacy.id,
      userId: user.id,
      type: 'vocab',
      sourceLang: 'en',
      targetLang: 'zh',
      front: 'rice, meal',
      back: '米饭',
      readingsJson: '{"pinyin":"mǐ fàn"}',
      tagsJson: '["hsk1"]',
      payloadJson: '{}',
      origin: 'curated',
      createdAt: Date.now(),
    })
    .run()
  setUserSetting(db, user.id, 'seedVersion', '1')

  reconcileStarterDecks(db, user.id)

  expect(listDecks(db).some((d) => d.level === 'hsk1')).toBe(false)
  expect(listCards(db, user.id).some((c) => c.back === '米饭')).toBe(false)
  sqlite.close()
})

test('decks are shared: a second member reuses the seeded decks', () => {
  const { db, sqlite } = openDb(':memory:')
  const a = createUser(db, { username: 'a', passwordHash: 'x' })
  const b = createUser(db, { username: 'b', passwordHash: 'x' })
  seedStarterDecks(db, a.id)
  const before = listCards(db, a.id).length
  seedStarterDecks(db, b.id)
  expect(listDecks(db).map((d) => d.id)).toEqual(listDecks(db).map((d) => d.id))
  expect(listCards(db, b.id).length).toBe(before)
  sqlite.close()
})

test('deleting a member keeps the shared decks, until the last member is gone', () => {
  const { db, sqlite } = openDb(':memory:')
  const a = createUser(db, { username: 'a', passwordHash: 'x' })
  const b = createUser(db, { username: 'b', passwordHash: 'x' })
  seedStarterDecks(db, a.id)
  expect(deleteUser(db, a.id)).toBe(true)
  // the creator is gone, the decks are not
  expect(listDecks(db).length).toBe(2)
  expect(deleteUser(db, toUserId('nobody'))).toBe(false)
  expect(deleteUser(db, b.id)).toBe(true)
  expect(listDecks(db).length).toBe(0)
  expect(listCards(db).length).toBe(0)
  sqlite.close()
})
