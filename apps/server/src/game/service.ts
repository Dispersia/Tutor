import type { Db } from '../db/client'
import { addXpEvent, getStats, sumXp, upsertStats, xpEventsFor } from '../db/repo'
import type { EventBus } from '../events'
import { levelInfo } from './levels'

/** UTC calendar day as YYYY-MM-DD (the streak granularity — UTC only). */
export function todayDay(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** Distinct active days, newest first — all derived in UTC. */
export function activeDays(db: Db, userId: string): string[] {
  const set = new Set(xpEventsFor(db, userId).map((r) => todayDay(r.createdAt)))
  return [...set].sort().reverse()
}

export function dailyXp(db: Db, userId: string, day: string): number {
  return xpEventsFor(db, userId)
    .filter((r) => todayDay(r.createdAt) === day)
    .reduce((n, r) => n + r.amount, 0)
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

/**
 * Consecutive active days ending today (or yesterday, so a streak survives until
 * you miss a whole day). Pure + unit-tested.
 */
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

export interface GameSummary {
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
}

/** Appends to the XP ledger, recomputes totals/level, emits events. */
export function awardXp(
  db: Db,
  bus: EventBus,
  userId: string,
  amount: number,
  reason: string,
  sourceId?: string,
): { total: number; level: number; leveledUp: boolean } {
  const before = getStats(db, userId).level
  addXpEvent(db, userId, amount, reason, sourceId)
  const total = sumXp(db, userId)
  const info = levelInfo(total)
  upsertStats(db, userId, { xpTotal: total, level: info.level })
  bus.emit('xp.awarded', { userId, amount, reason, total })
  const leveledUp = info.level > before
  if (leveledUp) bus.emit('level.up', { userId, level: info.level })
  return { total, level: info.level, leveledUp }
}

/** Marks the user active today and recomputes the streak. */
export function recordActivity(db: Db, bus: EventBus, userId: string): number {
  const days = activeDays(db, userId)
  const streak = streakFromDays(days)
  upsertStats(db, userId, { streakDays: streak, lastActiveDay: days[0] ?? todayDay() })
  bus.emit('streak.updated', { userId, days: streak })
  return streak
}

export function summary(db: Db, userId: string): GameSummary {
  const s = getStats(db, userId)
  const info = levelInfo(s.xpTotal)
  const today = todayDay()
  const daily = dailyXp(db, userId, today)
  const goal = s.dailyGoal || 50
  return {
    xp: s.xpTotal,
    level: info.level,
    intoLevel: info.intoLevel,
    forNext: info.forNext,
    progress: info.progress,
    streak: s.streakDays,
    dailyGoal: goal,
    dailyXp: daily,
    goalPct: Math.min(1, daily / goal),
    todayActive: s.lastActiveDay === today,
  }
}

/** Rebuilds every cached stat purely from the append-only XP ledger. */
export function rebuildStats(db: Db, userId: string): GameSummary {
  const total = sumXp(db, userId)
  const days = activeDays(db, userId)
  const streak = streakFromDays(days)
  upsertStats(db, userId, {
    xpTotal: total,
    level: levelInfo(total).level,
    streakDays: streak,
    lastActiveDay: days[0] ?? null,
  })
  return summary(db, userId)
}
