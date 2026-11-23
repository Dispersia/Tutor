/** Action XP, idle rigs, the gather log and the materials bank. */

import type { UserId } from '../../ids'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { RigState } from '../../game/idle'
import { ITEM_BY_ID, ITEMS, type ItemDef } from '../../game/skills'
import type { Db } from '../client'
import { actionProgress, gatherLog, inventory } from '../schema'
import {
  addGearPiece,
  countGearPieces,
  listGearInstances,
  removeGearPieces,
  spareGearPieces,
} from './gear'
import { id, now } from './helpers'

export function getActionXp(db: Db, userId: UserId, actionId: string): number {
  const row = db
    .select()
    .from(actionProgress)
    .where(and(eq(actionProgress.userId, userId), eq(actionProgress.actionId, actionId)))
    .get()
  return row?.xp ?? 0
}

export function listActionProgress(db: Db, userId: UserId) {
  return db.select().from(actionProgress).where(eq(actionProgress.userId, userId)).all()
}

/** Every action's rig for a user, in one query (keyed by action id). */
export function listRigStates(db: Db, userId: UserId): Map<string, RigState> {
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
  userId: UserId,
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
export function getRigState(db: Db, userId: UserId, actionId: string): RigState | undefined {
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
export function setRigState(db: Db, userId: UserId, actionId: string, rig: RigState): void {
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
export function addGatherLog(db: Db, userId: UserId, actionId: string, completions: number): void {
  db.insert(gatherLog).values({ id: id(), userId, actionId, completions, createdAt: now() }).run()
}

export function listGatherLog(db: Db, userId: UserId, actionId: string) {
  return db
    .select()
    .from(gatherLog)
    .where(and(eq(gatherLog.userId, userId), eq(gatherLog.actionId, actionId)))
    .orderBy(asc(gatherLog.createdAt))
    .all()
}

// --- the bank ----------------------------------------------------------------
// Materials are stacks in `inventory`. Equipment is not: the pieces a member
// owns are their `gear_instances` rows, so every read and write below routes an
// equipment item to them and a count can never disagree with the pieces.

type InventoryRow = typeof inventory.$inferSelect

/** The equipment definition behind an item id, or undefined for a material. */
function gearItem(itemId: string): ItemDef | undefined {
  const item = ITEM_BY_ID.get(itemId)
  return item?.slot ? item : undefined
}

export function getItemCount(db: Db, userId: UserId, itemId: string): number {
  if (gearItem(itemId)) return countGearPieces(db, userId, itemId)
  const row = db
    .select()
    .from(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)))
    .get()
  return row?.count ?? 0
}

/**
 * How many of an item a recipe, a rig or a drill may **spend**. For equipment
 * that is the spare pieces only — worn gear is owned (`getItemCount`) but never
 * consumed.
 */
export function spendableCount(db: Db, userId: UserId, itemId: string): number {
  if (gearItem(itemId)) return spareGearPieces(db, userId, itemId).length
  return getItemCount(db, userId, itemId)
}

/** The whole bank: material stacks, plus one row per equipment item owned. */
export function listInventory(db: Db, userId: UserId): InventoryRow[] {
  const stacks = db.select().from(inventory).where(eq(inventory.userId, userId)).all()
  return [...stacks.filter((r) => !gearItem(r.itemId)), ...gearStacks(db, userId)]
}

/** Owned equipment as bank rows: the count is the number of pieces. */
function gearStacks(db: Db, userId: UserId): InventoryRow[] {
  const byItem = new Map<string, InventoryRow>()
  for (const g of listGearInstances(db, userId)) {
    const row = byItem.get(g.itemId) ?? { userId, itemId: g.itemId, count: 0, updatedAt: 0 }
    row.count += 1
    row.updatedAt = Math.max(row.updatedAt, g.createdAt)
    byItem.set(g.itemId, row)
  }
  return [...byItem.values()]
}

/**
 * Adds (or removes, with a negative delta) items; never goes below zero. For
 * equipment that means pieces: each one added is rolled with `rand` (the plain
 * base piece without it); each one removed is a spare before a worn one.
 */
export function addItems(
  db: Db,
  userId: UserId,
  itemId: string,
  delta: number,
  rand?: () => number,
): void {
  const gear = gearItem(itemId)
  if (gear) return addGearPieces(db, userId, gear, delta, rand)
  addToStack(db, userId, itemId, delta)
}

function addGearPieces(
  db: Db,
  userId: UserId,
  item: ItemDef,
  delta: number,
  rand?: () => number,
): void {
  if (delta < 0) return removeGearPieces(db, userId, item.id, -delta)
  for (let i = 0; i < delta; i++) addGearPiece(db, userId, item, rand)
}

const GEAR_ITEM_IDS = ITEMS.filter((i) => i.slot).map((i) => i.id)

/** Equipment stacks left in `inventory` from before pieces were instances. */
export function listLegacyGearStacks(db: Db): InventoryRow[] {
  return db.select().from(inventory).where(inArray(inventory.itemId, GEAR_ITEM_IDS)).all()
}

export function deleteInventoryStack(db: Db, userId: UserId, itemId: string): void {
  db.delete(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)))
    .run()
}

function addToStack(db: Db, userId: UserId, itemId: string, delta: number): void {
  db.insert(inventory)
    .values({ userId, itemId, count: Math.max(0, delta), updatedAt: now() })
    .onConflictDoUpdate({
      target: [inventory.userId, inventory.itemId],
      set: { count: sql`max(0, ${inventory.count} + ${delta})`, updatedAt: now() },
    })
    .run()
}
