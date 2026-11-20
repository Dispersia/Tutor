import { expect, test } from 'bun:test'
import { FSRS6_DEFAULT_WEIGHTS, FSRS6Model } from 'ts-fsrs/models/fsrs-6'
import {
  AGAIN,
  DAY_MS,
  EASY,
  FSRS6_WEIGHTS,
  GOOD,
  HARD,
  LEARNING_STEPS,
  MIN_MS,
  NEW_STATE,
  RELEARNING_STEPS,
  countDue,
  countNew,
  isLearned,
  nextInterval,
  ratingFromScore,
  retrievability,
  sameDayStability,
  schedule,
  selectCardId,
  type FsrsState,
} from './srs'

/** The reference implementation, used only to assert parity in these tests. */
const reference = FSRS6Model.create({
  config: {
    weights: [...FSRS6_DEFAULT_WEIGHTS],
    enableShortTerm: true,
    numRelearningSteps: RELEARNING_STEPS.length,
  },
})

const DAY = DAY_MS
const now = 1_000_000_000_000

test('ratingFromScore is two-way: Again when wrong, Good when right', () => {
  expect(ratingFromScore(100, true)).toBe(GOOD)
  expect(ratingFromScore(65, true)).toBe(GOOD)
  expect(ratingFromScore(0, false)).toBe(AGAIN)
  expect(ratingFromScore(65, false)).toBe(AGAIN)
})

test('Anki defaults: 21 weights, decay w20, 1m/10m steps', () => {
  expect(FSRS6_WEIGHTS).toHaveLength(21)
  expect(FSRS6_WEIGHTS[20]).toBe(0.1542)
  expect(LEARNING_STEPS).toEqual([1, 10])
  expect(RELEARNING_STEPS).toEqual([10])
})

test('forgetting curve hits 0.9 at t = stability', () => {
  expect(retrievability(10, 0)).toBe(1)
  expect(retrievability(10, 10)).toBeCloseTo(0.9, 5)
  expect(retrievability(10, 20)).toBeLessThan(0.9)
  expect(retrievability(0, 5)).toBe(0)
})

test('nextInterval shortens as desired retention rises', () => {
  const relaxed = nextInterval(20, 0.8)
  const normal = nextInterval(20, 0.9)
  const strict = nextInterval(20, 0.97)
  expect(normal).toBeLessThan(relaxed)
  expect(strict).toBeLessThan(normal)
  expect(normal).toBe(20) // round(S) at the default retention
})

test('a new card walks Anki learning steps and graduates', () => {
  const good = schedule(NEW_STATE, GOOD, now)
  expect(good.state.state).toBe('learning')
  expect(good.state.step).toBe(1)
  expect(good.intervalDays).toBe(0)
  expect(good.dueAt).toBe(now + 10 * MIN_MS)

  const again = schedule(NEW_STATE, AGAIN, now)
  expect(again.state.step).toBe(0)
  expect(again.dueAt).toBe(now + 1 * MIN_MS)

  // Easy graduates straight away to a multi-day interval.
  const easy = schedule(NEW_STATE, EASY, now)
  expect(easy.state.state).toBe('review')
  expect(easy.intervalDays).toBeGreaterThan(1)
  expect(easy.dueAt).toBe(now + easy.intervalDays * DAY)
  expect(isLearned(easy.state)).toBe(true)

  // Second Good on the same day graduates the card with a review interval.
  const graduate = schedule(good.state, GOOD, now + 60_000)
  expect(graduate.state.state).toBe('review')
  expect(graduate.intervalDays).toBeGreaterThanOrEqual(1)
  expect(isLearned(graduate.state)).toBe(true)
})

test('successful reviews grow the interval', () => {
  const easy = schedule(NEW_STATE, EASY, now)
  const later = now + easy.intervalDays * DAY
  const next = schedule(easy.state, GOOD, later)
  expect(next.state.state).toBe('review')
  expect(next.intervalDays).toBeGreaterThan(easy.intervalDays)
  expect(next.state.stability).toBeGreaterThan(easy.state.stability)
})

test('a lapse drops to relearning and keeps stability from growing', () => {
  const easy = schedule(NEW_STATE, EASY, now)
  const later = now + easy.intervalDays * DAY
  const lapsed = schedule(easy.state, AGAIN, later)
  expect(lapsed.state.state).toBe('relearning')
  expect(lapsed.intervalDays).toBe(0)
  expect(lapsed.dueAt).toBe(later + 10 * MIN_MS)
  expect(lapsed.state.lapses).toBe(1)
  expect(lapsed.state.stability).toBeLessThanOrEqual(easy.state.stability)

  // Relearning graduates back to review after a Good.
  const done = schedule(lapsed.state, GOOD, later + 10 * MIN_MS)
  expect(done.state.state).toBe('review')
  expect(done.intervalDays).toBeGreaterThanOrEqual(1)
})

test('memory updates match the ts-fsrs reference for every rating', () => {
  const card: FsrsState = {
    ...NEW_STATE,
    state: 'review',
    stability: 20,
    difficulty: 5,
    reps: 3,
    intervalDays: 20,
    dueAt: now,
    lastReviewAt: now - 10 * DAY,
  }
  for (const rating of [AGAIN, HARD, GOOD, EASY] as const) {
    const ours = schedule(card, rating, now)
    const ref = reference.step({
      memoryState: { stability: card.stability, difficulty: card.difficulty },
      rating,
      elapsedDays: 10,
    })
    expect(ours.state.stability).toBeCloseTo(ref.stability, 9)
    expect(ours.state.difficulty).toBeCloseTo(ref.difficulty, 9)
  }
})

test('same-day updates match ts-fsrs, including the no-shrink floor on Hard', () => {
  for (const stability of [0.001, 0.05, 2.3]) {
    for (const rating of [AGAIN, HARD, GOOD, EASY] as const) {
      const card: FsrsState = {
        ...NEW_STATE,
        state: 'review',
        stability,
        difficulty: 6,
        intervalDays: 2,
        dueAt: now,
        lastReviewAt: now,
      }
      const ours = schedule(card, rating, now)
      const ref = reference.step({
        memoryState: { stability, difficulty: 6 },
        rating,
        elapsedDays: 0,
      })
      expect(ours.state.stability).toBeCloseTo(ref.stability, 9)
      expect(ours.state.difficulty).toBeCloseTo(ref.difficulty, 9)
    }
  }
  // the floor the old hand-rolled core was missing
  expect(sameDayStability(0.05, HARD)).toBeGreaterThanOrEqual(0.05)
})

test('isLearned is true only once the card is in review with a day+ interval', () => {
  expect(isLearned(undefined)).toBe(false)
  expect(isLearned(NEW_STATE)).toBe(false)
  const good = schedule(NEW_STATE, GOOD, now)
  expect(isLearned(good.state)).toBe(false)
  const easy = schedule(NEW_STATE, EASY, now)
  expect(isLearned(easy.state)).toBe(true)
})

test('selectCardId prefers overdue, then new, then soonest due', () => {
  const state = (dueAt: number): FsrsState => ({ ...NEW_STATE, state: 'review', dueAt })
  const srs = new Map<string, FsrsState>([
    ['a', state(now - DAY)], // overdue
    ['b', state(now + DAY)], // not due
  ])
  expect(selectCardId(['b', 'c', 'a'], srs, now)).toBe('a')

  // nothing overdue -> a brand-new card
  const none = new Map<string, FsrsState>([['b', state(now + DAY)]])
  expect(selectCardId(['b', 'c'], none, now)).toBe('c')

  // all scheduled -> the soonest due
  const all = new Map<string, FsrsState>([
    ['b', state(now + 5 * DAY)],
    ['c', state(now + DAY)],
  ])
  expect(selectCardId(['b', 'c'], all, now)).toBe('c')

  expect(selectCardId([], all, now)).toBeUndefined()
})

test('countDue / countNew', () => {
  const srs = new Map<string, FsrsState>([
    ['a', { ...NEW_STATE, state: 'review', dueAt: now - 1 }],
    ['b', { ...NEW_STATE, state: 'review', dueAt: now + DAY }],
  ])
  expect(countDue(['a', 'b', 'c'], srs, now)).toBe(1)
  expect(countNew(['a', 'b', 'c'], srs)).toBe(1)
})
