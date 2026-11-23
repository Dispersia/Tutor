/**
 * Worn slots and the combat-style ↔ armour/stat mapping (docs/DESIGN.md §13.5).
 */

import type { ArmourType, CombatStyle, PrimaryStat, Slot } from './types'

export const SLOTS: { id: Slot; label: string; icon: string; family: Slot[] }[] = [
  { id: 'head', label: 'Head', icon: '⛑️', family: ['head'] },
  { id: 'neck', label: 'Neck', icon: '📿', family: ['neck'] },
  { id: 'chest', label: 'Chest', icon: '🛡️', family: ['chest'] },
  { id: 'waist', label: 'Waist', icon: '🎗️', family: ['waist'] },
  { id: 'legs', label: 'Legs', icon: '🦿', family: ['legs'] },
  { id: 'feet', label: 'Feet', icon: '🥾', family: ['feet'] },
  { id: 'hands', label: 'Hands', icon: '🧤', family: ['hands'] },
  { id: 'ring1', label: 'Ring 1', icon: '💍', family: ['ring1', 'ring2'] },
  { id: 'ring2', label: 'Ring 2', icon: '💍', family: ['ring1', 'ring2'] },
  { id: 'trinket1', label: 'Trinket 1', icon: '🧿', family: ['trinket1', 'trinket2'] },
  { id: 'trinket2', label: 'Trinket 2', icon: '🧿', family: ['trinket1', 'trinket2'] },
  { id: 'mainHand', label: 'Main hand', icon: '🗡️', family: ['mainHand'] },
  { id: 'offHand', label: 'Off hand', icon: '🛡️', family: ['offHand'] },
]

/** Which slots an item may be worn in (rings and trinkets share a family). */
export function slotFamily(slot: Slot): Slot[] {
  return SLOTS.find((s) => s.id === slot)?.family ?? [slot]
}

/** The armour family a combat style wears. */
export function armourTypeForStyle(style: CombatStyle): ArmourType {
  if (style === 'ranged') return 'leather'
  if (style === 'magic') return 'cloth'
  if (style === 'melee') return 'plate'
  return 'jewelry'
}

/** The primary stat a combat style scales with. */
export function primaryStatForStyle(style: CombatStyle): PrimaryStat {
  if (style === 'ranged') return 'agility'
  if (style === 'magic') return 'intellect'
  return 'strength'
}

/** The combat style a weapon tag trains. */
export function combatStyleForTags(tags: string[] | undefined): CombatStyle {
  if (tags?.includes('bow')) return 'ranged'
  if (tags?.includes('staff')) return 'magic'
  return 'melee'
}
