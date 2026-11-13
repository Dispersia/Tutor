import { expect, test } from 'bun:test'
import { feedbackFor, gradeText, levenshtein, normalize, similarity } from './grading'

test('normalize strips case, tone marks, punctuation, spaces', () => {
  expect(normalize('Nǐ hǎo!')).toBe('nihao')
  expect(normalize(' 你好。')).toBe('你好')
  expect(normalize('Kon-nichiwa')).toBe('konnichiwa')
})

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
