import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addXpEvent, createUser, getStats, sumXp, upsertStats } from '../db/repo'
import { EventBus } from '../events'
import {
  awardXp,
  rebuildStats,
  recordActivity,
  shiftDay,
  streakFromDays,
  summary,
  todayDay,
} from './service'

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

test('awardXp appends to the ledger, levels up and emits events', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })

  const events: string[] = []
  bus.on('xp.awarded', (e) => events.push(`xp:${e.amount}:${e.total}`))
  bus.on('level.up', (e) => events.push(`level:${e.level}`))

  awardXp(db, bus, user.id, 60, 'review', 'ex1')
  expect(sumXp(db, user.id)).toBe(60)
  expect(getStats(db, user.id).level).toBe(1)

  const r = awardXp(db, bus, user.id, 60, 'review', 'ex2') // crosses 100 → level 2
  expect(r.total).toBe(120)
  expect(r.level).toBe(2)
  expect(r.leveledUp).toBe(true)
  expect(events).toEqual(['xp:60:60', 'xp:60:120', 'level:2'])
  sqlite.close()
})

test('recordActivity sets the streak and emits streak.updated', () => {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'bob', passwordHash: 'x' })

  let streakEvent = 0
  bus.on('streak.updated', (e) => (streakEvent = e.days))

  awardXp(db, bus, user.id, 10, 'review')
  const streak = recordActivity(db, bus, user.id)
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
  const bus = new EventBus()
  const user = createUser(db, { username: 'carol', passwordHash: 'x' })

  addXpEvent(db, user.id, 60, 'review')
  addXpEvent(db, user.id, 90, 'review')
  // corrupt the cached row
  upsertStats(db, user.id, { xpTotal: 9999, level: 42, streakDays: 99, lastActiveDay: 'nope' })

  const rebuilt = rebuildStats(db, user.id)
  expect(rebuilt.xp).toBe(150)
  expect(rebuilt.level).toBe(2)
  expect(rebuilt.streak).toBe(1) // both events are today
  expect(getStats(db, user.id).xpTotal).toBe(150)
  sqlite.close()
})
