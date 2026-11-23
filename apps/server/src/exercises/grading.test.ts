import { expect, test } from 'bun:test'
import { feedbackFor, gradeText, levenshtein, meaningAlternatives, similarity } from './grading'

test('levenshtein + similarity', () => {
  expect(levenshtein('kitten', 'sitting')).toBe(3)
  expect(levenshtein('', 'abc')).toBe(3)
  expect(similarity('hello', 'hello')).toBe(1)
  expect(similarity('你好', '你好')).toBe(1)
  expect(similarity('你好', '你们')).toBeCloseTo(0.5)
})

test('gradeText: exact, alternative readings, near misses', () => {
  expect(gradeText('你好', ['nǐ hǎo'], '你好')).toMatchObject({ score: 100, correct: true })
  expect(gradeText('你好', ['nǐ hǎo'], 'ni hao')).toMatchObject({ score: 100, correct: true })
  expect(gradeText('hello', [], 'hallo').score).toBeLessThan(100)
  expect(gradeText('hello', [], 'xyz')).toMatchObject({ correct: false })
  expect(gradeText('hello', [], '')).toMatchObject({ score: 0, correct: false })
})

test('feedbackFor only nudges when not perfect', () => {
  expect(feedbackFor(100, '你好')).toBeUndefined()
  expect(feedbackFor(85, '你好')).toContain('Almost')
  expect(feedbackFor(10, '你好')).toContain('Not quite')
})

test('meaningAlternatives splits multi-sense glosses', () => {
  expect(meaningAlternatives('of / possessive particle / nominalizer')).toEqual([
    'of',
    'possessive particle',
    'nominalizer',
  ])
  expect(meaningAlternatives('I, me')).toEqual(['I', 'me'])
  expect(meaningAlternatives('to be; is')).toEqual(['to be', 'is'])
  expect(meaningAlternatives('water')).toEqual(['water'])
})

const GLOSS = { gloss: true }

test('gradeText: a gloss matches without its "to", articles or parentheticals', () => {
  expect(gradeText('to eat', [], 'eat', GLOSS)).toMatchObject({ score: 100, correct: true })
  expect(gradeText('eat', [], 'to eat', GLOSS)).toMatchObject({ score: 100, correct: true })
  expect(gradeText('the dog (animal)', [], 'a dog', GLOSS)).toMatchObject({
    score: 100,
    correct: true,
  })
  expect(gradeText('cold (temperature)', [], 'cold', GLOSS)).toMatchObject({ correct: true })
  expect(gradeText('the', [], 'the', GLOSS)).toMatchObject({ score: 100, correct: true })
  expect(gradeText('to', [], 'a', GLOSS)).toMatchObject({ correct: false })
})

test('gradeText: one letter off is another word on a short gloss', () => {
  for (const [expected, answer] of [
    ['to live', 'to give'],
    ['cold', 'old'],
  ] as const) {
    const g = gradeText(expected, [], answer, GLOSS)
    expect(g.correct).toBe(false)
    expect(g.score).toBeLessThan(70)
  }
})

test('gradeText: a typo is forgiven only on a longer answer', () => {
  const g = gradeText('restaurant', [], 'restaurnt')
  expect(g.correct).toBe(true)
  expect(g.score).toBeGreaterThanOrEqual(80)
  expect(g.score).toBeLessThan(100)
  expect(gradeText('to understand', [], 'understnd', GLOSS).correct).toBe(true)
  expect(gradeText('restaurant', [], 'restrnt').correct).toBe(false)
  expect(gradeText('hello', [], 'hallo').correct).toBe(false)
})

test('gradeText: diacritics are optional on a romanisation, not on a spelling', () => {
  expect(gradeText('año', [], 'ano')).toMatchObject({ correct: false })
  expect(gradeText('year', ['año'], 'ano')).toMatchObject({ correct: false })
  expect(gradeText('año', [], 'Año')).toMatchObject({ score: 100, correct: true })
  expect(gradeText('你好', ['nǐ hǎo'], 'ni hao')).toMatchObject({ score: 100, correct: true })
  expect(gradeText('東京', ['tōkyō'], 'tokyo')).toMatchObject({ score: 100, correct: true })
  expect(gradeText('かき', [], 'がき').correct).toBe(false)
  expect(gradeText('阿姨', ['a yi'], 'yi').correct).toBe(false)
})

test('gradeText: a target-language answer keeps every word', () => {
  expect(gradeText('a veces', [], 'veces').correct).toBe(false)
  expect(gradeText('a veces', [], 'a veces')).toMatchObject({ score: 100, correct: true })
})
