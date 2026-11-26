import type { UserId } from '../../ids'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { stats, xpEvents } from '../schema'
import { DEFAULT_DAILY_GOAL } from '../../game/levels'
import { id, now } from './helpers'

export function addXpEvent(
  db: Db,
  userId: UserId,
  amount: number,
  reason: string,
  sourceId?: string,
): void {
  if (amount <= 0) return
  db.insert(xpEvents)
    .values({ id: id(), userId, amount, reason, sourceId: sourceId ?? null, createdAt: now() })
    .run()
}

export function sumXp(db: Db, userId: UserId): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .get()
  return Number(row?.total ?? 0)
}

const xpDay = (offsetMin: number) =>
  sql<string>`date(${xpEvents.createdAt} / 1000 + ${offsetMin * 60}, 'unixepoch')`

export function xpByDay(db: Db, userId: UserId, offsetMin = 0): { day: string; amount: number }[] {
  const day = xpDay(offsetMin)
  return db
    .select({ day, amount: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .groupBy(day)
    .all()
    .map((r) => ({ day: r.day, amount: Number(r.amount) }))
}

export function xpForDay(db: Db, userId: UserId, day: string, offsetMin = 0): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(and(eq(xpEvents.userId, userId), eq(xpDay(offsetMin), day)))
    .get()
  return Number(row?.total ?? 0)
}

export function getStats(db: Db, userId: UserId) {
  const row = db.select().from(stats).where(eq(stats.userId, userId)).get()
  return (
    row ?? {
      userId,
      xpTotal: 0,
      level: 1,
      streakDays: 0,
      lastActiveDay: null as string | null,
      dailyGoal: DEFAULT_DAILY_GOAL,
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

export function upsertStats(db: Db, userId: UserId, patch: StatsPatch): void {
  db.insert(stats)
    .values({
      userId,
      xpTotal: patch.xpTotal ?? 0,
      level: patch.level ?? 1,
      streakDays: patch.streakDays ?? 0,
      lastActiveDay: patch.lastActiveDay ?? null,
      dailyGoal: patch.dailyGoal ?? DEFAULT_DAILY_GOAL,
      updatedAt: now(),
    })
    .onConflictDoUpdate({ target: stats.userId, set: { ...patch, updatedAt: now() } })
    .run()
}

export function setDailyGoal(db: Db, userId: UserId, goal: number): void {
  upsertStats(db, userId, { dailyGoal: Math.max(10, Math.min(1000, Math.round(goal))) })
}
