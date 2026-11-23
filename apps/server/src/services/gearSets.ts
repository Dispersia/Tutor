/** Saved gear sets (docs/DESIGN.md §13.5.3). */

import {
  addGearSet,
  deleteGearSet,
  getGearInstance,
  getItemCount,
  listEquipment,
  listGearSets,
  setEquipment,
} from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { meetsRequirements } from '../game/gear'
import { ITEM_BY_ID, SLOTS, type CombatStyle } from '../game/skills'
import { loadPlayerCombat } from './combat'
import { requirementView, type GearRequirementView } from './gear'
import { skillLevelOf } from './progress'

// --- saved gear sets ---------------------------------------------------------

export interface GearSetView {
  id: string
  name: string
  combatStyle: CombatStyle
  slots: Record<string, { itemId: string; instanceId: string | null }>
  createdAt: number
  updatedAt: number
}

function parseSetSlots(
  json: string,
): Record<string, { itemId: string; instanceId: string | null }> {
  try {
    return JSON.parse(json) as Record<string, { itemId: string; instanceId: string | null }>
  } catch {
    return {}
  }
}

export function gearSetsView(db: Db, userId: string): GearSetView[] {
  return listGearSets(db, userId).map((row) => ({
    id: row.id,
    name: row.name,
    combatStyle: row.combatStyle as CombatStyle,
    slots: parseSetSlots(row.slotsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

/** Snapshots the current loadout under a name. */
export function saveGearSet(
  db: Db,
  userId: string,
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

/** A saved-set piece the player cannot wear yet. */
export interface GearSetSkip {
  slot: string
  itemId: string
  name: string
  missing: GearRequirementView[]
}

/** Swaps the worn gear to a saved set. Unknown/deleted instances are skipped. */
export function applyGearSet(
  db: Db,
  bus: EventBus,
  userId: string,
  setId: string,
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

interface SetEntry {
  itemId: string
  instanceId: string | null
}

interface SetSlotReq {
  userId: string
  slotId: string
  entry: SetEntry
  levels?: Map<string, number>
}

function equipFromSet(db: Db, bus: EventBus, req: SetSlotReq): GearSetSkip | undefined {
  const { userId, slotId, entry } = req
  const item = ITEM_BY_ID.get(entry.itemId)
  if (item) {
    const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill, req.levels))
    // Keep whatever is worn: the rest of the set still goes on.
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

/** Wears a rolled instance, or the plain item when the bank still holds one. */
function equipInstance(
  db: Db,
  bus: EventBus,
  userId: string,
  slotId: string,
  entry: SetEntry,
): undefined {
  const instance = entry.instanceId ? getGearInstance(db, userId, entry.instanceId) : undefined
  if (instance) {
    setEquipment(db, userId, slotId, instance.itemId, instance.id)
    bus.emit('item.equipped', { userId, itemId: instance.itemId, slot: slotId })
  } else if (ITEM_BY_ID.has(entry.itemId) && getItemCount(db, userId, entry.itemId) > 0) {
    setEquipment(db, userId, slotId, entry.itemId, null)
  }
  return undefined
}

export function removeGearSet(db: Db, userId: string, setId: string): void {
  deleteGearSet(db, userId, setId)
}
