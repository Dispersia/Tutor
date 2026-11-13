import { expect, test } from 'bun:test'
import { LESSON_SIZE, buildLessons } from './curriculum'

test('buildLessons splits cards into themed lessons', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `c${i}`)
  const lessons = buildLessons('hsk1', ids)
  expect(lessons.length).toBe(Math.ceil(20 / LESSON_SIZE))
  expect(lessons[0]!.cardIds.length).toBe(LESSON_SIZE)
  expect(lessons[0]!.title).toBe('Greetings')
  expect(lessons[0]!.id).toBe('hsk1:1')
  expect(lessons[1]!.id).toBe('hsk1:2')
  // the last lesson holds the remainder
  expect(lessons.at(-1)!.cardIds.length).toBe(20 - 2 * LESSON_SIZE)
  // cards are not duplicated across lessons
  const all = lessons.flatMap((l) => l.cardIds)
  expect(new Set(all).size).toBe(20)
})

test('unknown levels still produce numbered lessons', () => {
  const lessons = buildLessons('xx', ['a', 'b'])
  expect(lessons.length).toBe(1)
  expect(lessons[0]!.title).toBe('Lesson 1')
})

test('an empty deck has no lessons', () => {
  expect(buildLessons('hsk1', [])).toEqual([])
})
