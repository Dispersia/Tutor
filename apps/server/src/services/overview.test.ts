import { toCardId } from '../ids'
import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import {
  addXpEvent,
  createUser,
  getSrs,
  getStats,
  listSrsReviews,
  sumXp,
  upsertSrs,
  upsertStats,
} from '../db/repo'
import { EventBus } from '../events'
import {
  activitySeries,
  awardXp,
  rebuildStats,
  recordReview,
  touchActivity,
  shiftDay,
  streakFromDays,
  summary,
  todayDay,
  weekStart,
} from './index'

test('streakFromDays counts consecutive days ending today or yesterday', () => {
  const today = '2026-11-12'
  expect(streakFromDays([], today)).toBe(0)
  expect(streakFromDays([today], today)).toBe(1)
  expect(streakFromDays([today, '2026-11-11', '2026-11-10'], today)).toBe(3)
  // active yesterday but not today → streak survives
  expect(streakFromDays(['2026-11-11', '2026-11-10'], today)).toBe(2)
  // gap of a full day → reset
  expect(streakFromDays(['2026-11-09'], today)).toBe(0)
  // ignores future/irrelevant days
  expect(streakFromDays(['2026-10-01', today], today)).toBe(1)
})

test('shiftDay handles month/year boundaries', () => {
  expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
  expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
  expect(shiftDay('2026-11-12', 1)).toBe('2026-11-13')
})

test('weekStart returns the Monday of the UTC week', () => {
  // 2026-11-15 is a Sunday → its week starts on Monday 2026-11-09
  expect(weekStart('2026-11-15')).toBe('2026-11-09')
  expect(weekStart('2026-11-09')).toBe('2026-11-09')
  expect(weekStart('2026-11-10')).toBe('2026-11-09')
})

test('activitySeries lays out Monday-first weeks and buckets today', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'carol', passwordHash: 'x' })
  addXpEvent(db, user.id, 25, 'review', 'a')

  const { today, days } = activitySeries(db, user.id, 4)
  expect(days.length).toBe(28)
  // the grid opens on a Monday
  expect(new Date(`${days[0]!.day}T00:00:00Z`).getUTCDay()).toBe(1)
  // today sits in the final week and carries the XP
  const idx = days.findIndex((d) => d.day === today)
  expect(idx).toBeGreaterThanOrEqual(21)
  expect(days[idx]!.xp).toBe(25)
  expect(days.filter((d) => d.xp > 0).length).toBe(1)
  sqlite.close()
})

test('awardXp appends to the ledger, levels up and emits events', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })

  const events: string[] = []
  bus.on('xp.awarded', (e) => events.push(`xp:${e.amount}:${e.total}`))
  bus.on('level.up', (e) => events.push(`level:${e.level}`))

  awardXp(db, bus, user.id, { amount: 60, reason: 'review', sourceId: 'ex1' })
  expect(sumXp(db, user.id)).toBe(60)
  expect(getStats(db, user.id).level).toBe(1)

  const r = awardXp(db, bus, user.id, { amount: 60, reason: 'review', sourceId: 'ex2' }) // crosses 100 → level 2
  expect(r.total).toBe(120)
  expect(r.level).toBe(2)
  expect(r.leveledUp).toBe(true)
  expect(events).toEqual(['xp:60:60', 'xp:60:120', 'level:2'])
  sqlite.close()
})

test('touchActivity sets the streak and emits streak.updated', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'bob', passwordHash: 'x' })

  let streakEvent = 0
  bus.on('streak.updated', (e) => (streakEvent = e.days))

  awardXp(db, bus, user.id, { amount: 10, reason: 'review' })
  const streak = touchActivity(db, bus, user.id)
  expect(streak).toBe(1)
  expect(streakEvent).toBe(1)
  expect(getStats(db, user.id).lastActiveDay).toBe(todayDay())

  const s = summary(db, user.id)
  expect(s.xp).toBe(10)
  expect(s.streak).toBe(1)
  expect(s.dailyXp).toBe(10)
  expect(s.goalPct).toBeCloseTo(10 / s.dailyGoal)
  expect(s.todayActive).toBe(true)
  sqlite.close()
})

test('rebuildStats reconstructs everything from the XP ledger', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'carol', passwordHash: 'x' })

  addXpEvent(db, user.id, 60, 'review')
  addXpEvent(db, user.id, 90, 'review')
  // corrupt the cached row
  upsertStats(db, user.id, { xpTotal: 9999, level: 42, streakDays: 99, lastActiveDay: 'nope' })

  const rebuilt = rebuildStats(db, user.id)
  expect(rebuilt.xp).toBe(150)
  // the account level is derived from the professions now, not this ledger
  expect(rebuilt.level).toBe(1)
  expect(rebuilt.streak).toBe(1) // both events are today
  expect(getStats(db, user.id).xpTotal).toBe(150)
  sqlite.close()
})

test('recordReview appends an FSRS revlog row with the before/after state', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'dave', passwordHash: 'x' })

  const schedule = recordReview(db, bus, user.id, {
    cardId: toCardId('card-1'),
    score: 85,
    correct: true,
  })
  const log = listSrsReviews(db, user.id, toCardId('card-1'))
  expect(log.length).toBe(1)
  const row = log[0]!
  expect(row.rating).toBe(3) // 85 → Good
  expect(row.stateBefore).toBe('new')
  expect(row.stateAfter).toBe('learning')
  expect(row.stabilityBefore).toBe(0)
  expect(row.stabilityAfter).toBeCloseTo(schedule.stability, 6)
  expect(row.difficultyAfter).toBeCloseTo(schedule.difficulty, 6)
  expect(row.intervalDays).toBe(schedule.intervalDays)
  expect(row.elapsedDays).toBe(0)
  expect(row.desiredRetention).toBe(0.9)
  expect(row.dueAt).toBe(schedule.dueAt)
  expect(row.source).toBe('practice')
  sqlite.close()
})

test('a brand-new card never graduates on its first answer', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'frank', passwordHash: 'x' })

  // Every correct answer is a "Good" learning step (never "Easy"): the card
  // takes the learning steps, then graduates. It must not graduate in one shot.
  const first = recordReview(db, bus, user.id, {
    cardId: toCardId('card-1'),
    score: 100,
    correct: true,
  })
  expect(first.rating).toBe(3) // Good
  expect(first.state).toBe('learning')
  expect(first.intervalDays).toBe(0)
  expect(first.dueAt).toBeLessThan(Date.now() + 11 * 60 * 1000)

  let cur = first
  let reviews = 1
  while (cur.state !== 'review' && reviews < 10) {
    cur = recordReview(db, bus, user.id, { cardId: toCardId('card-1'), score: 100, correct: true })
    reviews++
  }
  expect(cur.state).toBe('review')
  expect(cur.intervalDays).toBeGreaterThanOrEqual(1)
  expect(reviews).toBeGreaterThan(1)

  // A wrong answer is Again, even on an established card.
  const wrong = recordReview(db, bus, user.id, {
    cardId: toCardId('card-1'),
    score: 0,
    correct: false,
  })
  expect(wrong.rating).toBe(1)
  sqlite.close()
})

test('the revlog records fractional elapsed days and the review source', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'erin', passwordHash: 'x' })

  recordReview(db, bus, user.id, { cardId: toCardId('card-1'), score: 85, correct: true })
  const prev = getSrs(db, user.id, toCardId('card-1'))!
  // pretend the previous review happened two days ago
  upsertSrs(db, user.id, toCardId('card-1'), {
    state: prev.state,
    step: prev.step,
    stability: prev.stability,
    difficulty: prev.difficulty,
    reps: prev.reps,
    lapses: prev.lapses,
    intervalDays: prev.intervalDays,
    dueAt: prev.dueAt,
    lastRating: prev.lastRating,
    lastReviewAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  })

  recordReview(db, bus, user.id, {
    cardId: toCardId('card-1'),
    score: 0,
    correct: false,
    source: 'combat',
  })
  const last = listSrsReviews(db, user.id, toCardId('card-1')).at(-1)!
  expect(last.source).toBe('combat')
  expect(last.rating).toBe(1) // wrong → Again
  expect(last.stateBefore).toBe('learning')
  expect(last.elapsedDays).toBeGreaterThan(1.9)
  expect(last.elapsedDays).toBeLessThan(2.1)
  sqlite.close()
})
