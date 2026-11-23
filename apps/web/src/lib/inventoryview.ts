/** Pure derivations for the inventory screen: slots, stat text and gear totals. */

import type {
  BandBuffs,
  GearInstanceDTO,
  GearStatId,
  GearStats,
  GearResponse,
  ItemDTO,
} from './skills'

/** One worn slot; rings and trinkets share a family. */
export interface SlotDef {
  id: string
  label: string
  icon: string
  family: string[]
}

/** Paper-doll order. */
export const SLOTS: SlotDef[] = [
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

export const STAT_ORDER: GearStatId[] = [
  'strength',
  'agility',
  'intellect',
  'stamina',
  'haste',
  'crit',
  'mastery',
]

export const STAT_LABEL: Record<GearStatId, string> = {
  strength: 'Strength',
  agility: 'Agility',
  intellect: 'Intellect',
  stamina: 'Stamina',
  haste: 'Haste',
  crit: 'Crit',
  mastery: 'Mastery',
}

/** `+4 Strength · +2 Crit` — the positive stats of a piece. */
export function statsText(stats: GearStats): string {
  return STAT_ORDER.filter((id) => stats[id] > 0)
    .map((id) => `+${stats[id]} ${STAT_LABEL[id]}`)
    .join(' · ')
}

/** The skill levels a piece demands, e.g. `Attack 10 · Defence 4`. */
export function requiresText(g: GearInstanceDTO): string {
  const reqs = Object.entries(g.requirements ?? {})
  if (!reqs.length) return ''
  return reqs
    .map(([skill, level]) => `${skill.charAt(0).toUpperCase() + skill.slice(1)} ${level}`)
    .join(' · ')
}

/** What the player is still missing, e.g. `Attack 3/10`. */
export function lockedText(g: GearInstanceDTO): string {
  return g.missing.map((m) => `${m.name} ${m.current}/${m.level}`).join(' · ')
}

/** The enchant a piece carries, as `Name (+2 strength)`. */
export function enchantsText(
  g: GearInstanceDTO,
  byId: Map<string, { name: string; value: number; stat: string }>,
): string {
  return (g.enchant ?? [])
    .map((id) => {
      const e = byId.get(id)
      return e ? `${e.name} (+${e.value} ${e.stat})` : id
    })
    .join(' · ')
}

/** Which gear instances can fill a slot (rings/trinkets share families). */
export function candidatesIn(slot: string, gear: GearInstanceDTO[]): GearInstanceDTO[] {
  const def = SLOTS.find((s) => s.id === slot)
  if (!def) return []
  return gear.filter((g) => def.family.includes(g.slot))
}

/** Gear instances worn in each slot. */
export function wornOf(
  equipment: { slot: string; instanceId: string | null }[],
  byId: Map<string, GearInstanceDTO>,
): Map<string, GearInstanceDTO> {
  const out = new Map<string, GearInstanceDTO>()
  for (const row of equipment) {
    if (row.instanceId) {
      const g = byId.get(row.instanceId)
      if (g) out.set(row.slot, g)
    }
  }
  return out
}

/** The worn piece's name in a slot, or `Empty`. */
export function wornName(
  slot: string,
  worn: Map<string, GearInstanceDTO>,
  itemMap: Map<string, ItemDTO>,
): string {
  const g = worn.get(slot)
  if (!g) return 'Empty'
  return itemMap.get(g.itemId)?.name ?? g.itemId
}

/** The slot's icon: the worn piece's, else the empty slot's. */
export function wornIcon(
  slot: string,
  worn: Map<string, GearInstanceDTO>,
  itemMap: Map<string, ItemDTO>,
): string {
  const g = worn.get(slot)
  if (g) return itemMap.get(g.itemId)?.icon ?? '◆'
  return SLOTS.find((s) => s.id === slot)?.icon ?? '◇'
}

/** Equipment-tier bank rows with no rolled instance (legacy crafts). */
export function baseEquipmentOf(
  inventory: { itemId: string; count: number }[],
  items: Map<string, ItemDTO>,
  gear: GearInstanceDTO[],
): { itemId: string; count: number }[] {
  const rolled = new Set(gear.map((g) => g.itemId))
  return inventory.filter((row) => {
    const item = items.get(row.itemId)
    return row.count > 0 && item?.tier === 'equipment' && !rolled.has(row.itemId)
  })
}

const emptyStats = (): GearStats => ({
  strength: 0,
  agility: 0,
  intellect: 0,
  stamina: 0,
  haste: 0,
  crit: 0,
  mastery: 0,
})

/**
 * The worn totals: the summed piece stats plus the active set bonuses, so the
 * inventory reads the same numbers the fight uses.
 */
export function totalsOf(
  worn: Iterable<GearInstanceDTO>,
  setBonuses: NonNullable<GearResponse['setBonuses']>,
): { stats: GearStats; armour: number; power: number; score: number } {
  const stats = emptyStats()
  let armour = 0
  let power = 0
  for (const g of worn) {
    for (const id of STAT_ORDER) stats[id] += g.stats[id]
    armour += g.armour
    power += g.power
  }
  const boosted = withSetBonuses(stats, armour, power, setBonuses ?? [])
  const total = STAT_ORDER.reduce((sum, id) => sum + boosted.stats[id], 0)
  return {
    ...boosted,
    score: Math.round(total + boosted.armour * 2 + boosted.power * 2),
  }
}

/** Applies the active set-bonus tiers to the worn totals, rounded. */
function withSetBonuses(
  stats: GearStats,
  armour: number,
  power: number,
  setBonuses: NonNullable<GearResponse['setBonuses']>,
): { stats: GearStats; armour: number; power: number } {
  for (const set of setBonuses) {
    for (const tier of set.active) {
      if (tier.stats) for (const id of STAT_ORDER) stats[id] += tier.stats[id] ?? 0
      if (tier.armourPct) armour *= 1 + tier.armourPct
      if (tier.powerPct) power *= 1 + tier.powerPct
    }
  }
  return { stats, armour: Math.round(armour), power: Math.round(power) }
}

/** The account-wide combat buffs from tier bands, positive only. */
export function combatBuffsOf(band: BandBuffs | undefined): { stat: keyof BandBuffs; v: number }[] {
  const sum = (k: keyof BandBuffs) => band?.[k] ?? 0
  return (
    [
      { stat: 'crit' as const, v: sum('crit') },
      { stat: 'haste' as const, v: sum('haste') },
      { stat: 'mastery' as const, v: sum('mastery') },
      { stat: 'lifesteal' as const, v: sum('lifesteal') },
      { stat: 'stamina' as const, v: sum('stamina') },
    ] as { stat: keyof BandBuffs; v: number }[]
  ).filter((x) => x.v > 0)
}
