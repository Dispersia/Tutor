import type { UserId } from '../../ids'
import { and, eq, inArray, sql } from 'drizzle-orm'
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

export function listRigStates(db: Db, userId: UserId): Map<string, RigState> {
  return new Map(
    listActionProgress(db, userId).map((r) => [
      r.actionId,
      {
        completions: r.completions,
        runEndsAt: r.runEndsAt,
        runStartedAt: r.runStartedAt,
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
    runStartedAt: row.runStartedAt,
    settledAt: row.settledAt,
    crafts: row.crafts,
    remainder: parseRemainder(row.remainderJson),
    choice: row.lastChoice ?? '',
  }
}

export function setRigState(db: Db, userId: UserId, actionId: string, rig: RigState): void {
  const cols = {
    completions: rig.completions,
    runEndsAt: rig.runEndsAt,
    runStartedAt: rig.runStartedAt,
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

export function addGatherLog(db: Db, userId: UserId, actionId: string, completions: number): void {
  db.insert(gatherLog).values({ id: id(), userId, actionId, completions, createdAt: now() }).run()
}

type InventoryRow = typeof inventory.$inferSelect

export interface InventoryStack {
  userId: UserId
  itemId: string
  count: number
}

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

export function spendableCount(db: Db, userId: UserId, itemId: string): number {
  if (gearItem(itemId)) return spareGearPieces(db, userId, itemId).length
  return getItemCount(db, userId, itemId)
}

export function listInventory(db: Db, userId: UserId): InventoryStack[] {
  const stacks = db.select().from(inventory).where(eq(inventory.userId, userId)).all()
  return [...stacks.filter((r) => !gearItem(r.itemId)).map(toStack), ...gearStacks(db, userId)]
}

function toStack(row: InventoryRow): InventoryStack {
  return { userId: row.userId, itemId: row.itemId, count: row.count }
}

function gearStacks(db: Db, userId: UserId): InventoryStack[] {
  const byItem = new Map<string, InventoryStack>()
  for (const g of listGearInstances(db, userId)) {
    const row = byItem.get(g.itemId) ?? { userId, itemId: g.itemId, count: 0 }
    row.count += 1
    byItem.set(g.itemId, row)
  }
  return [...byItem.values()]
}

export function addItems(db: Db, userId: UserId, itemId: string, delta: number): void {
  const gear = gearItem(itemId)
  if (gear) return addGearPieces(db, userId, gear, delta)
  addToStack(db, userId, itemId, delta)
}

function addGearPieces(db: Db, userId: UserId, item: ItemDef, delta: number): void {
  if (delta < 0) return removeGearPieces(db, userId, item.id, -delta)
  for (let i = 0; i < delta; i++) addGearPiece(db, userId, item)
}

const GEAR_ITEM_IDS = ITEMS.filter((i) => i.slot).map((i) => i.id)

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
