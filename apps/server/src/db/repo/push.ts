import type { UserId } from '../../ids'
import { and, eq, gt, lte, ne } from 'drizzle-orm'
import type { Db } from '../client'
import { actionProgress, pushSubscriptions } from '../schema'
import { id, now } from './helpers'

export interface PushSubscriptionRow {
  userId: UserId
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushSubscriptionInput extends PushSubscriptionRow {
  userAgent?: string
}

export function upsertPushSubscription(db: Db, sub: PushSubscriptionInput): void {
  db.insert(pushSubscriptions)
    .values({ id: id(), ...sub, createdAt: now() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: sub.userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent },
    })
    .run()
}

export function deletePushSubscription(db: Db, userId: UserId, endpoint: string): void {
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run()
}

export function listPushSubscriptions(db: Db, userId: UserId): PushSubscriptionRow[] {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all()
}

export function touchPushSubscription(db: Db, endpoint: string): void {
  db.update(pushSubscriptions)
    .set({ lastOkAt: now() })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run()
}

export interface DueRigRow {
  userId: UserId
  actionId: string
  completions: number
  runEndsAt: number
}

export function dueRigAlerts(db: Db, at: number, leadMs: number): DueRigRow[] {
  return db
    .select({
      userId: actionProgress.userId,
      actionId: actionProgress.actionId,
      completions: actionProgress.completions,
      runEndsAt: actionProgress.runEndsAt,
    })
    .from(actionProgress)
    .where(
      and(
        gt(actionProgress.runEndsAt, at),
        lte(actionProgress.runEndsAt, at + leadMs),
        ne(actionProgress.notifiedEndsAt, actionProgress.runEndsAt),
      ),
    )
    .all()
}

export function markRigAlerted(db: Db, userId: UserId, actionId: string, runEndsAt: number): void {
  db.update(actionProgress)
    .set({ notifiedEndsAt: runEndsAt })
    .where(
      and(
        eq(actionProgress.userId, userId),
        eq(actionProgress.actionId, actionId),
        eq(actionProgress.runEndsAt, runEndsAt),
      ),
    )
    .run()
}

export function listActiveRigs(db: Db, userId: UserId, at: number) {
  return db
    .select({
      actionId: actionProgress.actionId,
      completions: actionProgress.completions,
      runEndsAt: actionProgress.runEndsAt,
    })
    .from(actionProgress)
    .where(and(eq(actionProgress.userId, userId), gt(actionProgress.runEndsAt, at)))
    .all()
}
