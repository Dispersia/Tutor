import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser } from '../db/repo'
import { growthPlan } from './growth'

test('a growth plan reads the stored rules and counts only word cards as known', async () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'g', passwordHash: 'x' })
  const hints = { 茶: { reading: 'ㄔㄚˊ', meaning: 'tea' } }
  const deck = createDeck(db, user.id, {
    name: 'd',
    sourceLang: 'en',
    targetLang: 'zh',
    settings: {
      wordSource: 'anki',
      words: ['我', '喝', '茶'],
      cursor: 1,
      variant: 'simplified',
      readingScript: 'pinyin',
      pitchAccent: true,
      hints,
    },
  })
  const add = (back: string, template: string) =>
    addCard(db, user.id, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: 'zh',
      front: back,
      back,
      readings: {},
      tags: [],
      payload: { template, step: 1 },
      origin: 'llm',
    })
  add('我', 'vocab')
  add('喝', 'grammar')

  const plan = (await growthPlan(db, user.id, deck.id))!
  expect(plan.knownWords).toEqual(['我'])
  expect(plan.words).toEqual(['喝', '茶'])
  expect(plan.cardCount).toBe(2)
  expect(plan.ctx).toMatchObject({
    variant: 'simplified',
    readingScript: 'pinyin',
    pitchAccent: true,
    hints,
  })
  sqlite.close()
})
