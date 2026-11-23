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

export function craftGearInstance(
  db: Db,
  userId: UserId,
  item: ItemDef,
  rand: () => number = Math.random,
): GearInstanceId {
  return addGearPiece(db, userId, item, rand)
}

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

export const backfillGearInstances = atomic(backfillGearInstancesTx)

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

export function spareGearPiece(db: Db, userId: UserId, itemId: string): GearInstanceId | undefined {
  const worn = new Set(listEquipment(db, userId).map((e) => e.instanceId))
  return listGearInstances(db, userId).find((g) => g.itemId === itemId && !worn.has(g.id))?.id
}
