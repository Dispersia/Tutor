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
    if (!entry) {
      setEquipment(db, userId, slot.id, null)
      continue
    }
    const item = ITEM_BY_ID.get(entry.itemId)
    if (item) {
      const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill, levels))
      if (!gate.ok) {
        // Keep whatever is worn: the rest of the set still goes on.
        skipped.push({
          slot: slot.id,
          itemId: entry.itemId,
          name: item.name,
          missing: requirementView(gate.missing),
        })
        continue
      }
    }
    const instance = entry.instanceId ? getGearInstance(db, userId, entry.instanceId) : undefined
    if (instance) {
      setEquipment(db, userId, slot.id, instance.itemId, instance.id)
      bus.emit('item.equipped', { userId, itemId: instance.itemId, slot: slot.id })
    } else if (ITEM_BY_ID.has(entry.itemId) && getItemCount(db, userId, entry.itemId) > 0) {
      setEquipment(db, userId, slot.id, entry.itemId, null)
    }
  }
  return { ok: true, skipped }
}

export function removeGearSet(db: Db, userId: string, setId: string): void {
  deleteGearSet(db, userId, setId)
}
