import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser, upsertSrs } from '../db/repo'
import { knownWordsFor } from './srs'

const learned = {
  state: 'review',
  step: 0,
  stability: 5,
  difficulty: 5,
  reps: 3,
  lapses: 0,
  intervalDays: 7,
  dueAt: 0,
  lastRating: 3,
  lastReviewAt: 0,
}

function seed() {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'a', passwordHash: 'x' })
  const ja = createDeck(db, user.id, { name: 'ja', sourceLang: 'en', targetLang: 'ja' })
  const zh = createDeck(db, user.id, { name: 'zh', sourceLang: 'en', targetLang: 'zh' })
  const japanese = addCard(db, user.id, {
    deckId: ja.id,
    sourceLang: 'en',
    targetLang: 'ja',
    front: 'I',
    back: '私',
  })
  const chinese = addCard(db, user.id, {
    deckId: zh.id,
    sourceLang: 'en',
    targetLang: 'zh',
    front: 'I',
    back: '我',
  })
  upsertSrs(db, user.id, japanese.id, learned)
  upsertSrs(db, user.id, chinese.id, learned)
  return { db, sqlite, userId: user.id }
}

test('known words are scoped to one language', () => {
  const { db, sqlite, userId } = seed()
  expect([...knownWordsFor(db, userId, 'ja')]).toEqual(['私'])
  expect([...knownWordsFor(db, userId, 'zh')]).toEqual(['我'])
  expect([...knownWordsFor(db, userId, 'ko')]).toEqual([])
  sqlite.close()
})
