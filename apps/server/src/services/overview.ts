/** Global XP, streak and the account summary (docs/DESIGN.md §13). */

import type { UserId } from '../ids'
import { addXpEvent, getStats, sumXp, upsertStats, xpByDay, xpForDay } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { levelInfo } from '../game/levels'
import { accountLevel } from './board'
import { dayOf, userDay, userOffsetMin } from './clock'
import { aggregateBonuses } from './progress'

/** UTC calendar day as YYYY-MM-DD: the day for a member with no time zone stored. */
export function todayDay(ts: number = Date.now()): string {
  return dayOf(ts)
}

/** The member's active days (their own calendar days), newest first. */
export function activeDays(db: Db, userId: UserId): string[] {
  return xpByDay(db, userId, userOffsetMin(db, userId))
    .map((r) => r.day)
    .sort()
    .reverse()
}

export function dailyXp(db: Db, userId: UserId, day: string): number {
  return xpForDay(db, userId, day, userOffsetMin(db, userId))
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

/** Monday of the UTC week containing `day` (the activity map's column start). */
export function weekStart(day: string): string {
  const dt = new Date(`${day}T00:00:00Z`)
  const dow = (dt.getUTCDay() + 6) % 7 // Monday = 0
  return shiftDay(day, -dow)
}

export interface ActivityDay {
  day: string
  xp: number
}

/**
 * Daily XP for the last `weeks` weeks as a heat-map grid: columns are weeks
 * (Monday first), the last column is the current week, oldest day first. One
 * pass over the ledger — never one query per day (docs/DESIGN.md §13).
 */
export function activitySeries(
  db: Db,
  userId: UserId,
  weeks = 18,
): { today: string; days: ActivityDay[] } {
  const offset = userOffsetMin(db, userId)
  const today = dayOf(Date.now(), offset)
  const byDay = new Map(xpByDay(db, userId, offset).map((r) => [r.day, r.amount]))
  const gridStart = shiftDay(weekStart(today), -(weeks - 1) * 7)
  const days: ActivityDay[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = shiftDay(gridStart, i)
    days.push({ day: d, xp: byDay.get(d) ?? 0 })
  }
  return { today, days }
}

export function streakFromDays(days: string[], today: string = todayDay()): number {
  if (days.length === 0) return 0
  const set = new Set(days)
  let start = today
  if (!set.has(start)) {
    const yesterday = shiftDay(today, -1)
    if (!set.has(yesterday)) return 0
    start = yesterday
  }
  let n = 0
  let cur = start
  while (set.has(cur)) {
    n++
    cur = shiftDay(cur, -1)
  }
  return n
}

export function awardXp(
  db: Db,
  bus: EventBus,
  userId: UserId,
  req: { amount: number; reason: string; sourceId?: string },
): { total: number; level: number; leveledUp: boolean } {
  const before = getStats(db, userId).level
  const bonus = aggregateBonuses(db, userId).globalXp
  const gained = Math.max(0, Math.round(req.amount * (1 + bonus)))
  addXpEvent(db, userId, gained, req.reason, req.sourceId)
  const total = sumXp(db, userId)
  const info = levelInfo(total)
  upsertStats(db, userId, { xpTotal: total, level: info.level })
  bus.emit('xp.awarded', { userId, amount: gained, reason: req.reason, total })
  const leveledUp = info.level > before
  if (leveledUp) bus.emit('level.up', { userId, level: info.level })
  return { total, level: info.level, leveledUp }
}

export function touchActivity(db: Db, bus: EventBus, userId: UserId): number {
  const days = activeDays(db, userId)
  const today = userDay(db, userId)
  const streak = streakFromDays(days, today)
  upsertStats(db, userId, { streakDays: streak, lastActiveDay: days[0] ?? today })
  bus.emit('streak.updated', { userId, days: streak })
  return streak
}

export interface GameSummary {
  /** lifetime review XP (the daily-goal / heat-map metric, not the level) */
  xp: number
  /** the account level: the mean of every profession's level, out of 100 */
  level: number
  /** how far the average profession is toward its next level (0..1) */
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
}

function streakAlive(lastActiveDay: string | null, today: string): boolean {
  return lastActiveDay === today || lastActiveDay === shiftDay(today, -1)
}

export function summary(db: Db, userId: UserId): GameSummary {
  const s = getStats(db, userId)
  const today = userDay(db, userId)
  const daily = dailyXp(db, userId, today)
  const goal = s.dailyGoal || 50
  const account = accountLevel(db, userId)
  return {
    xp: s.xpTotal,
    level: account.level,
    progress: account.progress,
    // The stored streak is only rewritten by a review: after a missed day it is
    // stale until then, so a gap reads as broken straight away.
    streak: streakAlive(s.lastActiveDay, today) ? s.streakDays : 0,
    dailyGoal: goal,
    dailyXp: daily,
    goalPct: Math.min(1, daily / goal),
    todayActive: s.lastActiveDay === today,
  }
}

export function rebuildStats(db: Db, userId: UserId): GameSummary {
  const total = sumXp(db, userId)
  const days = activeDays(db, userId)
  upsertStats(db, userId, {
    xpTotal: total,
    level: levelInfo(total).level,
    streakDays: streakFromDays(days, userDay(db, userId)),
    lastActiveDay: days[0] ?? null,
  })
  return summary(db, userId)
}
