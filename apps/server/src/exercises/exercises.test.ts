import { expect, test } from 'bun:test'
import type { Card, ExerciseContext, Learner } from '@tutor/core'
import { exerciseCatalog, registry } from './index'

const learner: Learner = { id: 'u1', nativeLang: 'en', targetLang: 'zh', level: 'hsk1' }

function ctx(partial: Partial<Card> = {}, distractors: string[] = []): ExerciseContext {
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
    origin: 'curated',
    createdAt: 0,
    ...partial,
  }
  return { card, learner, distractors }
}

test('catalog lists the built-in exercises', () => {
  const ids = exerciseCatalog().map((e) => e.id)
  for (const id of [
    'translate.front_to_back',
    'translate.back_to_front',
    'multiple_choice',
    'type_listen',
    'speak_word',
    'converse',
  ]) {
    expect(ids).toContain(id)
  }
})

test('translate.front_to_back: exact and via reading', async () => {
  const def = registry.get('translate.front_to_back')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.prompt).toContain('hello')
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
  expect((await def.grade(c, inst, 'ni hao')).score).toBe(100) // reading accepted
  const wrong = await def.grade(c, inst, '再见')
  expect(wrong.correct).toBe(false)
  expect(wrong.expected).toBe('你好')
  expect(def.xp({ score: 100, correct: true }, inst)).toBe(15)
  expect(def.xp({ score: 40, correct: false }, inst)).toBe(1)
})

test('translate.back_to_front', async () => {
  const def = registry.get('translate.back_to_front')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.prompt).toContain('你好')
  expect((await def.grade(c, inst, 'hello')).correct).toBe(true)
})

test('multiple_choice generates choices incl. the answer and grades exactly', async () => {
  const def = registry.get('multiple_choice')!
  const c = ctx({}, ['再见', '谢谢', '我'])
  const inst = await def.generate(c)
  const choices = inst.data.choices as string[]
  expect(choices).toContain('你好')
  expect(choices.length).toBe(4)
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
  expect((await def.grade(c, inst, '再见')).correct).toBe(false)
})

test('type_listen exposes audio text', async () => {
  const def = registry.get('type_listen')!
  const c = ctx()
  const inst = await def.generate(c)
  expect(inst.data.audioText).toBe('你好')
  expect((await def.grade(c, inst, '你好')).correct).toBe(true)
})

test('speak_word grades a transcript', async () => {
  const def = registry.get('speak_word')!
  const c = ctx()
  const inst = await def.generate(c)
  const good = await def.grade(c, inst, '你好')
  expect(good.correct).toBe(true)
  expect(good.detail?.transcript).toBe('你好')
  const empty = await def.grade(c, inst, '')
  expect(empty.correct).toBe(false)
})

test('converse without a judge falls back to a heuristic', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  const inst = await def.generate(c)
  const used = await def.grade(c, inst, '你好，我是学生。')
  expect(used.score).toBeGreaterThanOrEqual(60)
  const english = await def.grade(c, inst, 'hello there')
  expect(english.correct).toBe(false)
})

test('converse uses the injected judge when present', async () => {
  const def = registry.get('converse')!
  const c = ctx()
  c.judge = async () => ({ score: 91, correct: true, feedback: 'Great use of the word.' })
  const inst = await def.generate(c)
  const r = await def.grade(c, inst, '你好')
  expect(r.score).toBe(91)
  expect(r.feedback).toContain('Great')
})
