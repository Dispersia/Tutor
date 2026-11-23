/** Action XP, idle rigs, the gather log and the materials bank. */

import { and, asc, eq, sql } from 'drizzle-orm'
import type { RigState } from '../../game/idle'
import type { Db } from '../client'
import { actionProgress, gatherLog, inventory } from '../schema'
import { id, now } from './helpers'

export function getActionXp(db: Db, userId: string, actionId: string): number {
  const row = db
    .select()
    .from(actionProgress)
    .where(and(eq(actionProgress.userId, userId), eq(actionProgress.actionId, actionId)))
    .get()
  return row?.xp ?? 0
}

export function listActionProgress(db: Db, userId: string) {
  return db.select().from(actionProgress).where(eq(actionProgress.userId, userId)).all()
}

/** Every action's rig for a user, in one query (keyed by action id). */
export function listRigStates(db: Db, userId: string): Map<string, RigState> {
  return new Map(
    listActionProgress(db, userId).map((r) => [
      r.actionId,
      {
        completions: r.completions,
        runEndsAt: r.runEndsAt,
        settledAt: r.settledAt,
        crafts: r.crafts,
        remainder: parseRemainder(r.remainderJson),
        choice: r.lastChoice ?? '',
      } satisfies RigState,
    ]),
  )
}

export function setActionXp(
  db: Db,
  userId: string,
  actionId: string,
  xp: number,
  level: number,
): void {
  db.insert(actionProgress)
    .values({ userId, actionId, xp, level, updatedAt: now() })
    .onConflictDoUpdate({
      target: [actionProgress.userId, actionProgress.actionId],
      set: { xp, level, updatedAt: now() },
    })
    .run()
}

// --- idle rigs (docs/DESIGN.md §13.5.1) --------------------------------------

/** The action's idle rig, or `undefined` if it has never been completed. */
export function getRigState(db: Db, userId: string, actionId: string): RigState | undefined {
  const row = db
    .select()
    .from(actionProgress)
    .where(and(eq(actionProgress.userId, userId), eq(actionProgress.actionId, actionId)))
    .get()
  if (!row) return undefined
  return {
    completions: row.completions,
    runEndsAt: row.runEndsAt,
    settledAt: row.settledAt,
    crafts: row.crafts,
    remainder: parseRemainder(row.remainderJson),
    choice: row.lastChoice ?? '',
  }
}

/** Writes only the rig columns, leaving xp/level (written by `setActionXp`) alone. */
export function setRigState(db: Db, userId: string, actionId: string, rig: RigState): void {
  const cols = {
    completions: rig.completions,
    runEndsAt: rig.runEndsAt,
    settledAt: rig.settledAt,
    crafts: rig.crafts,
    remainderJson: JSON.stringify(rig.remainder),
    lastChoice: rig.choice ?? '',
    updatedAt: now(),
  }
  db.insert(actionProgress)
    .values({ userId, actionId, ...cols })
    .onConflictDoUpdate({ target: [actionProgress.userId, actionProgress.actionId], set: cols })
    .run()
}

function parseRemainder(json: string): Record<string, number> {
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** Appends one completion to the rig log (the determinism contract's source). */
export function addGatherLog(db: Db, userId: string, actionId: string, completions: number): void {
  db.insert(gatherLog).values({ id: id(), userId, actionId, completions, createdAt: now() }).run()
}

export function listGatherLog(db: Db, userId: string, actionId: string) {
  return db
    .select()
    .from(gatherLog)
    .where(and(eq(gatherLog.userId, userId), eq(gatherLog.actionId, actionId)))
    .orderBy(asc(gatherLog.createdAt))
    .all()
}

export function getItemCount(db: Db, userId: string, itemId: string): number {
  const row = db
    .select()
    .from(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)))
    .get()
  return row?.count ?? 0
}

export function listInventory(db: Db, userId: string) {
  return db.select().from(inventory).where(eq(inventory.userId, userId)).all()
}

/** Adds (or removes, with a negative delta) materials; never goes below zero. */
export function addItems(db: Db, userId: string, itemId: string, delta: number): void {
  db.insert(inventory)
    .values({ userId, itemId, count: Math.max(0, delta), updatedAt: now() })
    .onConflictDoUpdate({
      target: [inventory.userId, inventory.itemId],
      set: { count: sql`max(0, ${inventory.count} + ${delta})`, updatedAt: now() },
    })
    .run()
}
