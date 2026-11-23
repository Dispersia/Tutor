/** Rolling and recording crafted gear instances (docs/DESIGN.md §13.5.3). */

import { addGearInstance } from '../db/repo'
import type { Db } from '../db/client'
import { rollGearStats, statsOf } from '../game/gear'
import { ITEM_BY_ID, type ItemDef } from '../game/skills'

/** Creates a crafted instance for an item, rolling its quality and affixes. */
export function craftGearInstance(
  db: Db,
  userId: string,
  item: ItemDef,
  rand: () => number = Math.random,
): string {
  const roll = rollGearStats(item, rand)
  return addGearInstance(db, {
    userId,
    itemId: item.id,
    slot: item.slot!,
    quality: roll.quality,
    statsJson: JSON.stringify(roll.stats),
    armour: roll.armour,
    power: roll.power,
  })
}

/**
 * A deterministic common instance from an item's base stats. Used when an old
 * bank stack (or a test fixture) equips a piece that was never rolled.
 */
export function ensureBaseGearInstance(db: Db, userId: string, item: ItemDef): string {
  return addGearInstance(db, {
    userId,
    itemId: item.id,
    slot: item.slot!,
    quality: 'common',
    statsJson: JSON.stringify(statsOf(item)),
    armour: item.armour ?? 0,
    power: item.power ?? 0,
  })
}

/** Rolls one instance per piece produced. Non-equipment items are ignored. */
export function recordGearCrafts(
  db: Db,
  userId: string,
  itemId: string,
  count: number,
  rand: () => number = Math.random,
): void {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot || item.tier !== 'equipment' || count <= 0) return
  for (let i = 0; i < count; i++) craftGearInstance(db, userId, item, rand)
}
