/**
 * Crafted gear instances (docs/DESIGN.md §13.5.3). A member's equipment is their
 * `gear_instances` rows and nothing else: the bank's count of a piece is the
 * number of instances (`db/repo/game.ts` routes every equipment read and write
 * there). This module rolls a piece and upgrades banks from before that held.
 */

import type { UserId, GearInstanceId } from '../ids'
import {
  addGearPiece,
  countGearPieces,
  deleteInventoryStack,
  listEquipment,
  listGearInstances,
  listLegacyGearStacks,
  listUnlinkedEquipment,
  setEquipment,
} from '../db/repo'
import type { Db } from '../db/client'
import { atomic } from '../db/repo/helpers'
import { ITEM_BY_ID, type ItemDef } from '../game/skills'

/** Creates a crafted instance for an item, rolling its quality and affixes. */
export function craftGearInstance(
  db: Db,
  userId: UserId,
  item: ItemDef,
  rand: () => number = Math.random,
): GearInstanceId {
  return addGearPiece(db, userId, item, rand)
}

/**
 * Upgrades banks from before instances were the only record of equipment
 * (a SQL migration cannot: which items are equipment, and their base stats, live
 * in the item table, not in the database). Every
 * legacy stack becomes that many pieces — a plain base piece for each one that
 * was never rolled — and its `inventory` row goes; every worn row without a
 * piece is given one. Runs at startup and is a no-op once done. Returns the
 * number of pieces it created.
 */
function backfillGearInstancesTx(db: Db): number {
  let created = 0
  for (const stack of listLegacyGearStacks(db)) {
    const item = ITEM_BY_ID.get(stack.itemId)!
    const missing = stack.count - countGearPieces(db, stack.userId, stack.itemId)
    for (let i = 0; i < missing; i++) addGearPiece(db, stack.userId, item)
    created += Math.max(0, missing)
    deleteInventoryStack(db, stack.userId, stack.itemId)
  }
  return created + linkWornGear(db)
}

/** {@link backfillGearInstancesTx}, all-or-nothing. */
export const backfillGearInstances = atomic(backfillGearInstancesTx)

/** Points each legacy worn row at a spare piece of its item, making one if needed. */
function linkWornGear(db: Db): number {
  let created = 0
  for (const row of listUnlinkedEquipment(db)) {
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item?.slot) continue
    const spare = spareGearPiece(db, row.userId, item.id)
    if (!spare) created += 1
    setEquipment(db, row.userId, row.slot, item.id, spare ?? addGearPiece(db, row.userId, item))
  }
  return created
}

/** The first piece of an item that is not being worn, if the member has one. */
export function spareGearPiece(db: Db, userId: UserId, itemId: string): GearInstanceId | undefined {
  const worn = new Set(listEquipment(db, userId).map((e) => e.instanceId))
  return listGearInstances(db, userId).find((g) => g.itemId === itemId && !worn.has(g.id))?.id
}
