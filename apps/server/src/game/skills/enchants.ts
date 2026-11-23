/**
 * The enchant catalog (docs/DESIGN.md §13.5.3.2) — content and its helpers.
 */

import type { Cost, GearStats, Slot } from './types'
import { essenceId, type EssenceId } from './essences'
import { slotFamily } from './slots'

// --- enchants (docs/DESIGN.md §13.5.3.2) -------------------------------------
//
// Enchants are catalogued by **slot** and unlocked at Enchanting levels. Each needs
// its own essence reagents, and applying one grants **no** XP — it is the payoff.

export interface EnchantDef {
  id: string
  name: string
  /** the equipment slot family it fits */
  slot: Slot
  stat: keyof GearStats
  /** flat points the enchant adds to the piece */
  value: number
  /** Enchanting level required */
  level: number
  reagents: Cost[]
}

/** The noun a slot's enchant names itself after. */
const SLOT_WORD: Partial<Record<Slot, string>> = {
  head: 'helm',
  neck: 'amulet',
  chest: 'chest',
  waist: 'belt',
  legs: 'greaves',
  feet: 'boots',
  hands: 'gloves',
  mainHand: 'blade',
  offHand: 'guard',
  ring1: 'ring',
  trinket1: 'charm',
}

/** Which essence an enchant's stat wants (§13.5.3.2). */
function familyForStat(stat: keyof GearStats): EssenceId {
  if (stat === 'agility') return 'leather'
  if (stat === 'intellect') return 'cloth'
  if (stat === 'crit' || stat === 'haste' || stat === 'mastery') return 'gem'
  return 'metal'
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/**
 * The catalog: one enchant per `[slot, stat]`, its `level` the Enchanting gate. All
 * enchants of a slot sit together, so a slot's stat menu opens a piece at a time.
 * Levels run 2 → 50; cost and payoff scale with them.
 */
const ENCHANT_TABLE: [Slot, keyof GearStats, number][] = [
  ['head', 'stamina', 2],
  ['head', 'intellect', 6],
  ['head', 'crit', 14],
  ['head', 'haste', 22],
  ['neck', 'intellect', 4],
  ['neck', 'mastery', 10],
  ['neck', 'stamina', 18],
  ['neck', 'crit', 26],
  ['chest', 'stamina', 2],
  ['chest', 'strength', 5],
  ['chest', 'agility', 9],
  ['chest', 'intellect', 13],
  ['chest', 'haste', 18],
  ['chest', 'crit', 25],
  ['waist', 'stamina', 3],
  ['waist', 'agility', 6],
  ['waist', 'haste', 9],
  ['waist', 'mastery', 15],
  ['legs', 'stamina', 4],
  ['legs', 'agility', 7],
  ['legs', 'strength', 8],
  ['legs', 'intellect', 12],
  ['legs', 'haste', 20],
  ['feet', 'agility', 3],
  ['feet', 'stamina', 11],
  ['feet', 'haste', 16],
  ['feet', 'crit', 21],
  ['hands', 'strength', 6],
  ['hands', 'intellect', 8],
  ['hands', 'crit', 12],
  ['hands', 'haste', 20],
  ['hands', 'mastery', 24],
  ['mainHand', 'strength', 5],
  ['mainHand', 'agility', 7],
  ['mainHand', 'intellect', 9],
  ['mainHand', 'mastery', 10],
  ['mainHand', 'crit', 16],
  ['mainHand', 'haste', 24],
  ['offHand', 'stamina', 4],
  ['offHand', 'crit', 8],
  ['offHand', 'haste', 13],
  ['offHand', 'mastery', 19],
  ['offHand', 'intellect', 23],
  ['ring1', 'crit', 5],
  ['ring1', 'haste', 7],
  ['ring1', 'mastery', 12],
  ['ring1', 'stamina', 16],
  ['ring1', 'intellect', 20],
  ['trinket1', 'stamina', 6],
  ['trinket1', 'crit', 11],
  ['trinket1', 'mastery', 14],
  ['trinket1', 'haste', 21],
  ['trinket1', 'agility', 25],
]

export const ENCHANTS: EnchantDef[] = ENCHANT_TABLE.map(([slot, stat, level]) => {
  const family = familyForStat(stat)
  const reagents: Cost[] = [{ item: essenceId(family), count: Math.max(1, Math.round(level / 4)) }]
  // A non-gem enchant also asks for a gem essence, so deeper enchants pull from two
  // families and Distill has to feed both.
  if (family !== 'gem') {
    reagents.push({ item: essenceId('gem'), count: Math.max(1, Math.round(level / 10)) })
  }
  // Weapons and off-hands also want wood (grips, frames, staves), so wood essence has
  // a home too.
  if (slot === 'mainHand' || slot === 'offHand') {
    reagents.push({ item: essenceId('wood'), count: Math.max(1, Math.round(level / 8)) })
  }
  return {
    id: `${slot}:${stat}`,
    name: `${cap(stat)} ${SLOT_WORD[slot] ?? 'piece'}`,
    slot,
    stat,
    value: 1 + Math.floor(level / 4),
    level,
    reagents,
  }
})

export const ENCHANT_BY_ID = new Map(ENCHANTS.map((e) => [e.id, e]))

/** The enchants that fit a piece's slot. */
export function enchantsForSlot(slot: Slot): EnchantDef[] {
  return ENCHANTS.filter((e) => e.slot === slot || slotFamily(e.slot).includes(slot))
}
