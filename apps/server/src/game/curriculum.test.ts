import { expect, test } from 'bun:test'
import { STEP_SIZE, buildLessons } from './curriculum'

const cards = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    front: `meaning ${i}`,
    back: `字${i}`,
    reading: `zi${i}`,
  }))

test('the frequency path introduces one word per step (n+1)', () => {
  const lessons = buildLessons('zhfreq', cards(3))
  expect(lessons.length).toBe(3)
  expect(lessons[0]!.cardIds.length).toBe(STEP_SIZE)
  expect(lessons[0]!.id).toBe('zhfreq:1')
  expect(lessons[0]!.title).toBe('字0')
  expect(lessons[0]!.newWord).toBe('字0')
  expect(lessons[0]!.reading).toBe('zi0')
  expect(lessons[1]!.id).toBe('zhfreq:2')
  // each card appears in exactly one step
  expect(new Set(lessons.flatMap((l) => l.cardIds)).size).toBe(3)
})

test('the same builder drives the Japanese path', () => {
  const lessons = buildLessons('jafreq', cards(2))
  expect(lessons.map((l) => l.id)).toEqual(['jafreq:1', 'jafreq:2'])
  expect(lessons.every((l) => l.cardIds.length === 1)).toBe(true)
})

test('an empty deck has no lessons', () => {
  expect(buildLessons('zhfreq', [])).toEqual([])
})
