import { expect, test } from 'bun:test'
import type { Card, ExerciseContext, ExerciseDef } from '@tutor/core'
import { drillFails, verifyCard } from './verify'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  deckId: null,
  type: 'grammar',
  sourceLang: 'en',
  targetLang: 'zh',
  front: 'possessive particle',
  back: '的',
  readings: {},
  tags: [],
  payload: {},
  metadata: {},
  origin: 'llm',
  createdAt: 0,
  ...over,
})

const ctx = (c: Card): ExerciseContext => ({
  card: c,
  learner: { id: 'u1', nativeLang: 'en', targetLang: 'zh', level: 'hsk1' },
  distractors: [],
  known: ['的'],
  seen: ['的'],
  showReadings: false,
})

interface StubOver {
  id?: string
  generate?: ExerciseDef<unknown>['generate']
  grade?: ExerciseDef<unknown>['grade']
}

const stub = (over: StubOver = {}): ExerciseDef<unknown> => ({
  id: 'x',
  title: '',
  modality: 'text',
  supports: () => true,
  generate: async (c) => ({
    exerciseId: 'x',
    cardId: c.card.id,
    modality: 'text',
    prompt: '',
    data: {},
  }),
  grade: async () => ({ score: 100, correct: true }),
  xp: () => 0,
  ...over,
})

test('drillFails flags a drill whose choices omit the right answer', async () => {
  const def = stub({
    generate: async (c) => ({
      exerciseId: 'x',
      cardId: c.card.id,
      modality: 'text',
      prompt: '',
      data: { choices: ['了', '地'] },
    }),
  })
  expect(await drillFails(def, ctx(card()))).toBe('the right answer is not offered')
})

test('drillFails flags a drill that grades its right answer wrong', async () => {
  const def = stub({ grade: async () => ({ score: 0, correct: false }) })
  expect(await drillFails(def, ctx(card()))).toBe('the right answer grades wrong')
})

test('drillFails flags a drill that cannot be built', async () => {
  const def = stub({
    generate: async () => {
      throw new Error('nope')
    },
  })
  expect(await drillFails(def, ctx(card()))).toBe('the drill could not be built')
})

test('drillFails accepts a sentence build whose bank holds every token', async () => {
  const def = stub({
    id: 'sentence_build',
    generate: async (c) => ({
      exerciseId: 'sentence_build',
      cardId: c.card.id,
      modality: 'text',
      prompt: '',
      data: { tokens: ['我', '喝'], bank: ['我', '喝', '茶'] },
    }),
    grade: async (_c, _i, answer) => ({
      score: 100,
      correct: (answer as string[]).join('') === '我喝',
    }),
  })
  expect(await drillFails(def, ctx(card()))).toBeUndefined()
})

test('verifyCard flags a grammar card whose answer repeats the prompt', async () => {
  const c = card({
    front: '有 indicates possession.',
    back: '我有',
    payload: {
      prompt: '我___',
      answer: '我有',
      options: ['我在', '我是', '我有'],
      rule: '有 indicates possession.',
    },
  })
  const verdict = await verifyCard(ctx(c))
  expect(verdict.ok).toBe(false)
  expect(verdict.failures).toContain('grammar_cloze: the answer repeats the prompt')
})

test('verifyCard passes a well-formed grammar card', async () => {
  const c = card({
    payload: {
      prompt: '他___風格。',
      answer: '的',
      options: ['的', '地', '得'],
      rule: 'possessive particle',
    },
  })
  expect(await verifyCard(ctx(c))).toEqual({ ok: true, failures: [] })
})

test('verifyCard flags a grammar prompt that ends at the blank', async () => {
  const c = card({
    payload: {
      prompt: '我___',
      answer: '的',
      options: ['的', '了', '不'],
      rule: 'Possessive particle',
    },
  })
  const verdict = await verifyCard(ctx(c))
  expect(verdict.ok).toBe(false)
  expect(verdict.failures).toContain('grammar_cloze: the prompt ends at the blank')
})
