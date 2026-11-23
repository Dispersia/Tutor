/** The XP ledger and the derived stats row (level, streak, daily goal). */

import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { stats, xpEvents } from '../schema'
import { id, now } from './helpers'

export function addXpEvent(
  db: Db,
  userId: string,
  amount: number,
  reason: string,
  sourceId?: string,
): void {
  if (amount <= 0) return
  db.insert(xpEvents)
    .values({ id: id(), userId, amount, reason, sourceId: sourceId ?? null, createdAt: now() })
    .run()
}

export function sumXp(db: Db, userId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .get()
  return Number(row?.total ?? 0)
}

/** The UTC day of an event, in SQL (`created_at` is epoch ms). */
const xpDay = sql<string>`date(${xpEvents.createdAt} / 1000, 'unixepoch')`

/**
 * Total XP per UTC day for a user, grouped in SQL so the streak and heat-map
 * never load the whole ledger. There is one row per active day.
 */
export function xpByDay(db: Db, userId: string): { day: string; amount: number }[] {
  return db
    .select({ day: xpDay, amount: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .groupBy(xpDay)
    .all()
    .map((r) => ({ day: r.day, amount: Number(r.amount) }))
}

/** The XP a user earned on one UTC day. */
export function xpForDay(db: Db, userId: string, day: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(and(eq(xpEvents.userId, userId), eq(xpDay, day)))
    .get()
  return Number(row?.total ?? 0)
}

export function getStats(db: Db, userId: string) {
  const row = db.select().from(stats).where(eq(stats.userId, userId)).get()
  return (
    row ?? {
      userId,
      xpTotal: 0,
      level: 1,
      streakDays: 0,
      lastActiveDay: null as string | null,
      dailyGoal: 50,
      updatedAt: 0,
    }
  )
}

export interface StatsPatch {
  xpTotal?: number
  level?: number
  streakDays?: number
  lastActiveDay?: string | null
  dailyGoal?: number
}

export function upsertStats(db: Db, userId: string, patch: StatsPatch): void {
  db.insert(stats)
    .values({
      userId,
      xpTotal: patch.xpTotal ?? 0,
      level: patch.level ?? 1,
      streakDays: patch.streakDays ?? 0,
      lastActiveDay: patch.lastActiveDay ?? null,
      dailyGoal: patch.dailyGoal ?? 50,
      updatedAt: now(),
    })
    .onConflictDoUpdate({ target: stats.userId, set: { ...patch, updatedAt: now() } })
    .run()
}

export function setDailyGoal(db: Db, userId: string, goal: number): void {
  upsertStats(db, userId, { dailyGoal: Math.max(10, Math.min(1000, Math.round(goal))) })
}
