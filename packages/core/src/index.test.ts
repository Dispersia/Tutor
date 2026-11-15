import { expect, test } from 'bun:test'
import { ExerciseRegistry, type Card, type ExerciseDef, type Learner } from './index'

const card: Card = {
  id: 'c1',
  deckId: 'd1',
  type: 'vocab',
  sourceLang: 'en',
  targetLang: 'zh',
  front: 'hello',
  back: '你好',
  readings: { pinyin: 'nǐ hǎo' },
  tags: [],
  payload: {},
  metadata: {},
  origin: 'curated',
  createdAt: 0,
}
const learner: Learner = { id: 'u1', nativeLang: 'en', targetLang: 'zh', level: 'hsk1' }

function makeDef(id: string, supports = true): ExerciseDef<string> {
  return {
    id,
    title: id,
    modality: 'text',
    supports: () => supports,
    async generate(ctx) {
      return { exerciseId: id, cardId: ctx.card.id, modality: 'text', prompt: 'p', data: {} }
    },
    async grade() {
      return { score: 100, correct: true }
    },
    xp: () => 5,
  }
}

test('registry: register, get, list, supports filtering', () => {
  const r = new ExerciseRegistry()
  r.register(makeDef('a')).register(makeDef('b')).register(makeDef('c', false))
  expect(r.get('a')?.title).toBe('a')
  expect(r.list().map((d) => d.id)).toEqual(['a', 'b', 'c'])
  expect(r.forCard(card, learner).map((d) => d.id)).toEqual(['a', 'b'])
})

test('registry: duplicate id throws', () => {
  const r = new ExerciseRegistry().register(makeDef('dup'))
  expect(() => r.register(makeDef('dup'))).toThrow(/duplicate/)
})

test('adding an exercise needs no core changes', () => {
  // This is the whole extensibility promise: a new def + one register() line.
  const r = new ExerciseRegistry().register(makeDef('brand_new'))
  expect(r.get('brand_new')).toBeDefined()
  expect(r.forCard(card, learner).map((d) => d.id)).toContain('brand_new')
})
