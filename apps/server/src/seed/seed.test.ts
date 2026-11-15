import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { createUser, listCards, listDecks } from '../db/repo'
import { seedStarterDecks } from './service'

test('seeding gives a user the frequency, HSK 1 and JLPT N5 decks, once', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })

  expect(seedStarterDecks(db, user.id)).toBe(true)
  const decks = listDecks(db, user.id)
  expect(decks.map((d) => d.name).sort()).toEqual(['HSK 1', 'JLPT N5', 'Mandarin · Frequency'])
  const total = decks.reduce((n, d) => n + Number(d.cardCount), 0)
  expect(total).toBeGreaterThan(200)

  // idempotent: seeding again is a no-op
  expect(seedStarterDecks(db, user.id)).toBe(false)
  expect(listDecks(db, user.id).length).toBe(3)

  // cards carry the native reading only: Zhuyin (zh), kana (ja) — no pinyin/romaji
  const hsk = decks.find((d) => d.name === 'HSK 1')!
  const cards = listCards(db, user.id, hsk.id)
  expect(cards[0]!.readings.zhuyin).toBeTruthy()
  expect(cards[0]!.readings.pinyin).toBeUndefined()
  expect(cards[0]!.back).toBe('你好')

  // Japanese cards carry their kana reading (furigana)
  const n5 = decks.find((d) => d.level === 'n5')!
  const n5Cards = listCards(db, user.id, n5.id)
  const kanjiCard = n5Cards.find((c) => c.back === '先生')!
  expect(kanjiCard.readings.kana).toBe('せんせい')

  // the frequency deck keeps its order, uses Traditional characters + Zhuyin
  const freq = decks.find((d) => d.level === 'zhfreq')!
  const freqCards = listCards(db, user.id, freq.id)
  expect(freqCards[0]!.back).toBe('我')
  expect(freqCards[0]!.payload.pos).toBe('pron')
  expect(freqCards[0]!.readings.zhuyin).toBe('ㄨㄛˇ')
  const tradCard = freqCards.find((c) => c.back === '學生')!
  expect(tradCard.readings.zhuyin).toBe('ㄒㄩㄝˊ ˙ㄕㄥ')
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
