import { expect, test } from 'bun:test'
import { LESSON_SIZE, STEP_SIZE, buildLessons, isFrequencyLevel } from './curriculum'

const cards = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    front: `meaning ${i}`,
    back: `字${i}`,
    reading: `zi${i}`,
  }))

test('buildLessons splits themed decks (hsk1) into 8-card lessons', () => {
  const lessons = buildLessons('hsk1', cards(20))
  expect(lessons.length).toBe(Math.ceil(20 / LESSON_SIZE))
  expect(lessons[0]!.cardIds.length).toBe(LESSON_SIZE)
  expect(lessons[0]!.title).toBe('Greetings')
  expect(lessons[0]!.id).toBe('hsk1:1')
  expect(lessons[1]!.id).toBe('hsk1:2')
  expect(lessons.at(-1)!.cardIds.length).toBe(20 - 2 * LESSON_SIZE)
  expect(new Set(lessons.flatMap((l) => l.cardIds)).size).toBe(20)
})

test('the frequency path introduces one word per step (n+1)', () => {
  const lessons = buildLessons('zhfreq', cards(3))
  expect(lessons.length).toBe(3)
  expect(lessons[0]!.cardIds.length).toBe(STEP_SIZE)
  expect(lessons[0]!.newWord).toBe('字0')
  expect(lessons[0]!.reading).toBe('zi0')
  expect(lessons[1]!.id).toBe('zhfreq:2')
  // each card appears in exactly one step
  expect(new Set(lessons.flatMap((l) => l.cardIds)).size).toBe(3)
  expect(isFrequencyLevel('zhfreq')).toBe(true)
  expect(isFrequencyLevel('hsk1')).toBe(false)
})

test('an empty deck has no lessons', () => {
  expect(buildLessons('hsk1', [])).toEqual([])
  expect(buildLessons('zhfreq', [])).toEqual([])
})
