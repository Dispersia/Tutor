import type { UserId } from '../ids'
import {
  DEFAULT_DAILY_GOAL,
  addXpEvent,
  getStats,
  reviewsByDay,
  sumXp,
  upsertStats,
  xpByDay,
  xpForDay,
} from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { accountLevel } from './board'
import { dayOf, userDay, userOffsetMin } from './clock'
import { aggregateBonuses } from './progress'

function activeDays(db: Db, userId: UserId): string[] {
  return xpByDay(db, userId, userOffsetMin(db, userId))
    .map((r) => r.day)
    .sort()
    .reverse()
}

function dailyXp(db: Db, userId: UserId, day: string): number {
  return xpForDay(db, userId, day, userOffsetMin(db, userId))
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayOf(Date.UTC(y!, m! - 1, d! + delta), 0)
}

export function weekStart(day: string): string {
  const dt = new Date(`${day}T00:00:00Z`)
  const dow = (dt.getUTCDay() + 6) % 7
  return shiftDay(day, -dow)
}

export interface ActivityDay {
  day: string
  xp: number
  reviews: number
}

export function activitySeries(
  db: Db,
  userId: UserId,
  weeks = 53,
): { today: string; days: ActivityDay[] } {
  const offset = userOffsetMin(db, userId)
  const today = dayOf(Date.now(), offset)
  const byDay = new Map(xpByDay(db, userId, offset).map((r) => [r.day, r.amount]))
  const reviews = new Map(reviewsByDay(db, userId, offset).map((r) => [r.day, r.count]))
  const gridStart = shiftDay(weekStart(today), -(weeks - 1) * 7)
  const days: ActivityDay[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = shiftDay(gridStart, i)
    days.push({ day: d, xp: byDay.get(d) ?? 0, reviews: reviews.get(d) ?? 0 })
  }
  return { today, days }
}

export function streakFromDays(days: string[], today: string): number {
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
): { total: number } {
  const bonus = aggregateBonuses(db, userId).globalXp
  const gained = Math.max(0, Math.round(req.amount * (1 + bonus)))
  addXpEvent(db, userId, gained, req.reason, req.sourceId)
  const total = sumXp(db, userId)
  upsertStats(db, userId, { xpTotal: total })
  bus.emit('xp.awarded', { userId, amount: gained, reason: req.reason, total })
  return { total }
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
  xp: number
  level: number
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
  const goal = s.dailyGoal || DEFAULT_DAILY_GOAL
  const account = accountLevel(db, userId)
  return {
    xp: s.xpTotal,
    level: account.level,
    progress: account.progress,
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
    streakDays: streakFromDays(days, userDay(db, userId)),
    lastActiveDay: days[0] ?? null,
  })
  return summary(db, userId)
}
