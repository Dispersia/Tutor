import type { CombatStyle, SkillId, Slot } from './types'

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

export function slotFamily(slot: Slot): Slot[] {
  return SLOTS.find((s) => s.id === slot)?.family ?? [slot]
}

const SLOT_ALIASES: Record<string, Slot> = { weapon: 'mainHand', body: 'chest' }

export function canonicalSlot(slot: string): Slot {
  return (SLOT_ALIASES[slot] ?? slot) as Slot
}

export function combatStyleForSkill(skill: SkillId): CombatStyle {
  if (skill === 'ranged') return 'ranged'
  if (skill === 'magic') return 'magic'
  return 'melee'
}

export function weaponSkill(tags: string[] | undefined): SkillId {
  if (tags?.includes('bow')) return 'ranged'
  if (tags?.includes('staff')) return 'magic'
  return 'strength'
}

export function combatStyleForTags(tags: string[] | undefined): CombatStyle {
  return combatStyleForSkill(weaponSkill(tags))
}
