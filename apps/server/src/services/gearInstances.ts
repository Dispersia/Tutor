import type { UserId, GearInstanceId } from '../ids'
import {
  addGearPiece,
  countGearPieces,
  deleteInventoryStack,
  getSetting,
  listAllGearInstances,
  listEquipment,
  listGearInstances,
  listLegacyGearStacks,
  listUnlinkedEquipment,
  setEquipment,
  setGearInstanceBaseline,
  setSetting,
} from '../db/repo'
import type { Db } from '../db/client'
import { atomic } from '../db/repo/helpers'
import { statsOf } from '../game/gear'
import { ITEM_BY_ID, type ItemDef } from '../game/skills'

export function craftGearInstance(db: Db, userId: UserId, item: ItemDef): GearInstanceId {
  return addGearPiece(db, userId, item)
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

const GEAR_BASELINE_KEY = 'gear.baseline.v1'

interface GearBaseline {
  statsJson: string
  armour: number
  power: number
}

function baselineOf(item: ItemDef): GearBaseline {
  return {
    statsJson: JSON.stringify(statsOf(item)),
    armour: item.armour ?? 0,
    power: item.power ?? 0,
  }
}

function matchesBaseline(
  row: { quality: string; statsJson: string; armour: number; power: number },
  baseline: GearBaseline,
): boolean {
  return (
    row.quality === 'common' &&
    row.statsJson === baseline.statsJson &&
    row.armour === baseline.armour &&
    row.power === baseline.power
  )
}

function normalizeGearInstancesTx(db: Db): number {
  if (getSetting(db, GEAR_BASELINE_KEY) === '1') return 0
  let changed = 0
  for (const row of listAllGearInstances(db)) {
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item?.slot) continue
    const baseline = baselineOf(item)
    if (matchesBaseline(row, baseline)) continue
    setGearInstanceBaseline(db, row, baseline)
    changed += 1
  }
  setSetting(db, GEAR_BASELINE_KEY, '1')
  return changed
}

export const normalizeGearInstances = atomic(normalizeGearInstancesTx)

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
