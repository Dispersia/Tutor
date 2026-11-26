import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser, getDeck, listCards } from '../db/repo'
import { growthPlan, startDeckGrowth } from './growth'
import { awaitDeckBuild } from './jobs'

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

test('a word its grammar card introduced counts as known when growing', async () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'g3', passwordHash: 'x' })
  const deck = createDeck(db, user.id, {
    name: 'd',
    sourceLang: 'en',
    targetLang: 'ja',
    settings: { wordSource: 'anki', words: ['私', 'は', '学生'], cursor: 2 },
  })
  const add = (back: string, template: string, payload: Record<string, unknown>) =>
    addCard(db, user.id, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: 'ja',
      front: back,
      back,
      readings: {},
      tags: [],
      payload: { template, ...payload },
      origin: 'llm',
    })
  add('私', 'vocab', { step: 1 })
  add('は', 'grammar', { step: 2, intro: true })
  const plan = (await growthPlan(db, user.id, deck.id))!
  expect(plan.knownWords).toEqual(['私', 'は'])
  expect(plan.words).toEqual(['学生'])
  sqlite.close()
})

test('a bounded growth adds just the requested words and advances the cursor', async () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'g2', passwordHash: 'x' })
  const deck = createDeck(db, user.id, {
    name: 'd',
    sourceLang: 'en',
    targetLang: 'zh',
    settings: { wordSource: 'anki', words: ['我', '喝', '茶', '水', '好'], cursor: 1 },
  })
  const planner = async (req: { words: string[] }) =>
    req.words.map((w) => ({ template: 'vocab' as const, front: `m ${w}`, back: w }))
  const started = await startDeckGrowth(db, user.id, deck.id, { count: 3, planner })
  expect(started).toBe(3)
  await awaitDeckBuild(deck.id)
  const vocab = listCards(db, user.id, deck.id)
    .filter((c) => c.payload.template === 'vocab')
    .map((c) => c.back)
  expect(vocab).toEqual(['喝', '茶', '水'])
  expect(getDeck(db, deck.id)!.settings.cursor).toBe(4)
  sqlite.close()
})
