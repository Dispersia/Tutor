import { expect, test } from 'bun:test'
import {
  LEARNED_REPS,
  NEW_SRS,
  RELEARN_MS,
  countDue,
  countNew,
  isLearned,
  qualityFromScore,
  schedule,
  selectCardId,
  type SrsState,
} from './srs'

const DAY = 24 * 60 * 60 * 1000
const now = 1_000_000_000_000

test('qualityFromScore maps scores to SM-2 quality', () => {
  expect(qualityFromScore(100, true)).toBe(5)
  expect(qualityFromScore(90, true)).toBe(5)
  expect(qualityFromScore(80, true)).toBe(4)
  expect(qualityFromScore(65, true)).toBe(3)
  expect(qualityFromScore(65, false)).toBe(2)
  expect(qualityFromScore(45, false)).toBe(1)
  expect(qualityFromScore(0, false)).toBe(0)
})

test('successful reviews space out: 1 day, 6 days, then ease × interval', () => {
  const a = schedule(NEW_SRS, 5, now)
  expect(a.reps).toBe(1)
  expect(a.intervalDays).toBe(1)
  expect(a.dueAt).toBe(now + DAY)

  const b = schedule(a, 5, now)
  expect(b.reps).toBe(2)
  expect(b.intervalDays).toBe(6)

  const c = schedule(b, 5, now)
  expect(c.reps).toBe(3)
  expect(c.intervalDays).toBe(Math.round(6 * b.ease))
  expect(c.intervalDays).toBeGreaterThan(6)
  expect(c.ease).toBeGreaterThan(b.ease) // q5 nudges ease up
})

test('a lapse resets reps and comes back in ten minutes', () => {
  let s = schedule(NEW_SRS, 5, now)
  s = schedule(s, 5, now)
  const lapsed = schedule(s, 1, now)
  expect(lapsed.reps).toBe(0)
  expect(lapsed.lapses).toBe(1)
  expect(lapsed.intervalDays).toBe(0)
  expect(lapsed.dueAt).toBe(now + RELEARN_MS)
  expect(lapsed.ease).toBeLessThan(s.ease)
})

test('ease stays within bounds', () => {
  let s = NEW_SRS
  for (let i = 0; i < 20; i++) s = schedule(s, 0, now)
  expect(s.ease).toBeGreaterThanOrEqual(1.3)
  let h = NEW_SRS
  for (let i = 0; i < 20; i++) h = schedule(h, 5, now)
  expect(h.ease).toBeLessThanOrEqual(2.8)
})

test('learned once a card survives a couple of reviews', () => {
  expect(isLearned(undefined)).toBe(false)
  const one = schedule(NEW_SRS, 5, now)
  expect(isLearned(one)).toBe(false)
  expect(isLearned(schedule(one, 5, now))).toBe(true)
  expect(LEARNED_REPS).toBe(2)
})

test('selectCardId prefers overdue, then new, then soonest due', () => {
  const state = (dueAt: number): SrsState => ({ ...NEW_SRS, reps: 1, dueAt })
  const srs = new Map<string, SrsState>([
    ['a', state(now - DAY)], // overdue
    ['b', state(now + DAY)], // not due
  ])
  expect(selectCardId(['b', 'c', 'a'], srs, now)).toBe('a')

  // nothing overdue -> a brand-new card
  const none = new Map<string, SrsState>([['b', state(now + DAY)]])
  expect(selectCardId(['b', 'c'], none, now)).toBe('c')

  // all scheduled -> the soonest due
  const all = new Map<string, SrsState>([
    ['b', state(now + 5 * DAY)],
    ['c', state(now + DAY)],
  ])
  expect(selectCardId(['b', 'c'], all, now)).toBe('c')

  expect(selectCardId([], all, now)).toBeUndefined()
})

test('countDue / countNew', () => {
  const srs = new Map<string, SrsState>([
    ['a', { ...NEW_SRS, reps: 1, dueAt: now - 1 }],
    ['b', { ...NEW_SRS, reps: 1, dueAt: now + DAY }],
  ])
  expect(countDue(['a', 'b', 'c'], srs, now)).toBe(1)
  expect(countNew(['a', 'b', 'c'], srs)).toBe(1)
})
