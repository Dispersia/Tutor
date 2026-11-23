/** Web-push subscriptions and the idle-rig alert scan. */

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

/**
 * Stores a device's subscription. The endpoint identifies the device, so a
 * re-subscribe (permission granted again, key rotated) replaces the old row
 * instead of piling up dead ones.
 *
 * A device has one owner: when another member enables notifications in the same
 * browser, it becomes theirs and the previous member stops receiving on it.
 */
export function upsertPushSubscription(db: Db, sub: PushSubscriptionInput): void {
  db.insert(pushSubscriptions)
    .values({ id: id(), ...sub, createdAt: now() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: sub.userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent },
    })
    .run()
}

/** Removes one of `userId`'s subscriptions (never another member's device). */
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

/** An active rig as the alert scan needs it. */
export interface DueRigRow {
  userId: UserId
  actionId: string
  completions: number
  runEndsAt: number
}

/**
 * Rigs whose run ends within `leadMs` and that have not been announced yet.
 * Pure read: settling happens on the next board fetch, so this never writes.
 */
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

/** Records that this deadline has been announced (so a later scan skips it). */
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

/** Every rig still running right now, for the client's local timer. */
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
