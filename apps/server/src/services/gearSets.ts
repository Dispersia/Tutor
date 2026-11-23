import type { UserId, GearInstanceId, GearSetId } from '../ids'
import {
  addGearSet,
  deleteGearSet,
  getGearInstance,
  listEquipment,
  listGearSets,
  setEquipment,
} from '../db/repo'
import type { Db } from '../db/client'
import { atomic } from '../db/repo/helpers'
import type { EventBus } from '../events'
import { meetsRequirements } from '../game/gear'
import { ITEM_BY_ID, SLOTS, type CombatStyle } from '../game/skills'
import { loadPlayerCombat } from './combat'
import { requirementView, type GearRequirementView } from './gear'
import { spareGearPiece } from './gearInstances'
import { skillLevelOf } from './progress'

export interface GearSetView {
  id: GearSetId
  name: string
  combatStyle: CombatStyle
  slots: Record<string, { itemId: string; instanceId: GearInstanceId | null }>
  createdAt: number
  updatedAt: number
}

function parseSetSlots(
  json: string,
): Record<string, { itemId: string; instanceId: GearInstanceId | null }> {
  try {
    return JSON.parse(json) as Record<string, { itemId: string; instanceId: GearInstanceId | null }>
  } catch {
    return {}
  }
}

export function gearSetsView(db: Db, userId: UserId): GearSetView[] {
  return listGearSets(db, userId).map((row) => ({
    id: row.id,
    name: row.name,
    combatStyle: row.combatStyle as CombatStyle,
    slots: parseSetSlots(row.slotsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export function saveGearSet(
  db: Db,
  userId: UserId,
  name: string,
  combatStyle?: CombatStyle,
  levels?: Map<string, number>,
): GearSetView {
  const slots: GearSetView['slots'] = {}
  for (const e of listEquipment(db, userId)) {
    slots[e.slot] = { itemId: e.itemId, instanceId: e.instanceId ?? null }
  }
  const style = combatStyle ?? loadPlayerCombat(db, userId, levels).combatStyle
  const id = addGearSet(db, { userId, name, combatStyle: style, slotsJson: JSON.stringify(slots) })
  return gearSetsView(db, userId).find((s) => s.id === id)!
}

export interface GearSetSkip {
  slot: string
  itemId: string
  name: string
  missing: GearRequirementView[]
}

function applyGearSetTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  setId: GearSetId,
  levels?: Map<string, number>,
): { ok: boolean; error?: string; skipped: GearSetSkip[] } {
  const set = gearSetsView(db, userId).find((s) => s.id === setId)
  if (!set) return { ok: false, error: 'set not found', skipped: [] }
  const skipped: GearSetSkip[] = []
  for (const slot of SLOTS) {
    const entry = set.slots[slot.id]
    if (!entry) setEquipment(db, userId, slot.id, null)
    else {
      const skip = equipFromSet(db, bus, { userId, slotId: slot.id, entry, levels })
      if (skip) skipped.push(skip)
    }
  }
  return { ok: true, skipped }
}

export const applyGearSet = atomic(applyGearSetTx)

interface SetEntry {
  itemId: string
  instanceId: GearInstanceId | null
}

interface SetSlotReq {
  userId: UserId
  slotId: string
  entry: SetEntry
  levels?: Map<string, number>
}

function equipFromSet(db: Db, bus: EventBus, req: SetSlotReq): GearSetSkip | undefined {
  const { userId, slotId, entry } = req
  const item = ITEM_BY_ID.get(entry.itemId)
  if (item) {
    const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill, req.levels))
    if (!gate.ok) return skipView(slotId, entry.itemId, item, gate.missing)
  }
  return equipInstance(db, bus, userId, slotId, entry)
}

function skipView(
  slot: string,
  itemId: string,
  item: NonNullable<ReturnType<typeof ITEM_BY_ID.get>>,
  missing: Parameters<typeof requirementView>[0],
): GearSetSkip {
  return { slot, itemId, name: item.name, missing: requirementView(missing) }
}

function equipInstance(
  db: Db,
  bus: EventBus,
  userId: UserId,
  slotId: string,
  entry: SetEntry,
): undefined {
  const saved = entry.instanceId ? getGearInstance(db, userId, entry.instanceId) : undefined
  const instance = saved ?? spareOf(db, userId, entry.itemId)
  if (!instance) return undefined
  setEquipment(db, userId, slotId, instance.itemId, instance.id)
  bus.emit('item.equipped', { userId, itemId: instance.itemId, slot: slotId })
  return undefined
}

function spareOf(db: Db, userId: UserId, itemId: string) {
  const spare = spareGearPiece(db, userId, itemId)
  return spare ? getGearInstance(db, userId, spare) : undefined
}

export function removeGearSet(db: Db, userId: UserId, setId: GearSetId): void {
  deleteGearSet(db, userId, setId)
}
