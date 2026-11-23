import type { Cost, GearStats, Slot } from './types'
import { essenceId, type EssenceId } from './essences'

export interface EnchantDef {
  id: string
  name: string
  slot: Slot
  stat: keyof GearStats
  value: number
  level: number
  reagents: Cost[]
}

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

function familyForStat(stat: keyof GearStats): EssenceId {
  if (stat === 'agility') return 'leather'
  if (stat === 'intellect') return 'cloth'
  if (stat === 'crit' || stat === 'haste' || stat === 'mastery') return 'gem'
  return 'metal'
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

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
  if (family !== 'gem') {
    reagents.push({ item: essenceId('gem'), count: Math.max(1, Math.round(level / 10)) })
  }
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
