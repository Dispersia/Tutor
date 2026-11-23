/**
 * Gear stats (docs/DESIGN.md §13.5).
 *
 * Every craftable piece rolls a quality and a set of WoW-style stats. The
 * primaries decide the combat style the piece is built for (Strength → melee,
 * Agility → ranged, Intellect → magic), while the secondaries change how the
 * fight plays: Haste gives extra strikes, Crit multiplies a hit, Mastery boosts
 * the weapon's own style.
 *
 * Everything here is pure: the same seed and item always produce the same roll.
 */

import type {
  ArmourType,
  CombatStyle,
  GearQuality,
  GearStats,
  ItemDef,
  PrimaryStat,
  SkillId,
} from './skills'

export const EMPTY_STATS: GearStats = {
  strength: 0,
  agility: 0,
  intellect: 0,
  stamina: 0,
  haste: 0,
  crit: 0,
  mastery: 0,
}

export const STAT_IDS = [
  'strength',
  'agility',
  'intellect',
  'stamina',
  'haste',
  'crit',
  'mastery',
] as const

export const QUALITY_MULTIPLIER: Record<GearQuality, number> = {
  common: 1,
  uncommon: 1.15,
  rare: 1.35,
  epic: 1.6,
}

export const QUALITY_LABEL: Record<GearQuality, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
}

export function addStats(a: GearStats, b: Partial<GearStats>): GearStats {
  return {
    strength: a.strength + (b.strength ?? 0),
    agility: a.agility + (b.agility ?? 0),
    intellect: a.intellect + (b.intellect ?? 0),
    stamina: a.stamina + (b.stamina ?? 0),
    haste: a.haste + (b.haste ?? 0),
    crit: a.crit + (b.crit ?? 0),
    mastery: a.mastery + (b.mastery ?? 0),
  }
}

export function sumStats(stats: GearStats): number {
  return STAT_IDS.reduce((sum, id) => sum + stats[id], 0)
}

/** A rough single number for scaling monsters and comparing sets. */
export function gearScore(stats: GearStats, armour: number, power: number): number {
  return Math.round(sumStats(stats) + armour * 2 + power * 2)
}

// --- armour set bonuses ------------------------------------------------------

export interface SetBonusTier {
  /** How many worn pieces of this armour type unlock the tier. */
  pieces: number
  /** Human label for the inventory screen. */
  label: string
  stats?: Partial<GearStats>
  armourPct?: number
  powerPct?: number
}

export interface GearSetDef {
  id: string
  name: string
  armourType: ArmourType
  tiers: SetBonusTier[]
}

/**
 * Wearing enough pieces of one armour family unlocks a set bonus. The set is
 * keyed by armour type, so a smithed plate loadout, a leather ranged loadout and
 * a cloth magic loadout each build toward their own bonuses. Jewellery has its
 * own smaller set.
 */
export const GEAR_SETS: GearSetDef[] = [
  {
    id: 'vanguard',
    name: 'Vanguard',
    armourType: 'plate',
    tiers: [
      { pieces: 2, label: '+10% armour', armourPct: 0.1 },
      { pieces: 4, label: '+20 crit', stats: { crit: 20 } },
      { pieces: 6, label: '+10% power', powerPct: 0.1 },
    ],
  },
  {
    id: 'trailblazer',
    name: 'Trailblazer',
    armourType: 'leather',
    tiers: [
      { pieces: 2, label: '+20 haste', stats: { haste: 20 } },
      { pieces: 4, label: '+20 crit', stats: { crit: 20 } },
      { pieces: 6, label: '+10% power', powerPct: 0.1 },
    ],
  },
  {
    id: 'arcanist',
    name: 'Arcanist',
    armourType: 'cloth',
    tiers: [
      { pieces: 2, label: '+20 mastery', stats: { mastery: 20 } },
      { pieces: 4, label: '+20 haste', stats: { haste: 20 } },
      { pieces: 6, label: '+10% power', powerPct: 0.1 },
    ],
  },
  {
    id: 'jeweler',
    name: "Jeweler's",
    armourType: 'jewelry',
    tiers: [
      { pieces: 2, label: '+15 stamina', stats: { stamina: 15 } },
      { pieces: 4, label: '+20 crit', stats: { crit: 20 } },
    ],
  },
]

export interface ActiveSetBonus {
  id: string
  name: string
  armourType: ArmourType
  /** Worn pieces that count toward this set. */
  pieces: number
  /** Tiers unlocked by the current piece count. */
  active: SetBonusTier[]
  /** The next tier, when one is still locked. */
  next: SetBonusTier | null
}

/** Resolves the worn armour-type counts into active and next set tiers. */
export function activeSetBonuses(counts: Partial<Record<ArmourType, number>>): ActiveSetBonus[] {
  return GEAR_SETS.map((set) => {
    const pieces = counts[set.armourType] ?? 0
    const active = set.tiers.filter((tier) => pieces >= tier.pieces)
    const next = set.tiers.find((tier) => pieces < tier.pieces) ?? null
    return { id: set.id, name: set.name, armourType: set.armourType, pieces, active, next }
  }).filter((set) => set.pieces > 0)
}

/** Applies the active set tiers to the player's totals. */
export function applySetBonuses(
  stats: GearStats,
  armour: number,
  power: number,
  sets: ActiveSetBonus[],
): { stats: GearStats; armour: number; power: number } {
  let nextStats = stats
  let nextArmour = armour
  let nextPower = power
  for (const set of sets) {
    for (const tier of set.active) {
      if (tier.stats) nextStats = addStats(nextStats, tier.stats)
      if (tier.armourPct) nextArmour *= 1 + tier.armourPct
      if (tier.powerPct) nextPower *= 1 + tier.powerPct
    }
  }
  return {
    stats: nextStats,
    armour: Math.round(nextArmour),
    power: Math.round(nextPower),
  }
}

export function combatStyleForSkill(skill: SkillId): CombatStyle {
  if (skill === 'ranged') return 'ranged'
  if (skill === 'magic') return 'magic'
  return 'melee'
}

export function primaryForCombatStyle(style: CombatStyle): PrimaryStat {
  if (style === 'ranged') return 'agility'
  if (style === 'magic') return 'intellect'
  return 'strength'
}

export function primaryForArmourType(armour: ArmourType): PrimaryStat {
  if (armour === 'leather') return 'agility'
  if (armour === 'cloth') return 'intellect'
  return 'strength'
}

/** Rating → percent. Diminishing, so stacking crit never reaches 100%. */
export function ratingToPercent(rating: number, scale = 250): number {
  if (rating <= 0) return 0
  return (100 * rating) / (rating + scale)
}

export function critPercent(crit: number): number {
  return ratingToPercent(crit, 220)
}

export function hastePercent(haste: number): number {
  return ratingToPercent(haste, 300)
}

export function masteryPercent(mastery: number): number {
  return ratingToPercent(mastery, 260)
}

export interface DerivedStats {
  /** The primary stat the equipped weapon scales with. */
  primary: number
  /** Crit chance as a fraction (0.12 = 12%). */
  crit: number
  /** Haste proc chance as a fraction. */
  haste: number
  /** Mastery damage bonus as a fraction. */
  mastery: number
}

export function deriveStats(stats: GearStats, skill: SkillId): DerivedStats {
  const primary = primaryForCombatStyle(combatStyleForSkill(skill))
  return {
    primary: stats[primary],
    crit: critPercent(stats.crit) / 100,
    haste: hastePercent(stats.haste) / 100,
    mastery: masteryPercent(stats.mastery) / 100,
  }
}

export interface GearRoll {
  stats: GearStats
  quality: GearQuality
  armour: number
  power: number
}

function rollQuality(rand: () => number): GearQuality {
  const r = rand()
  if (r < 0.08) return 'epic'
  if (r < 0.28) return 'rare'
  if (r < 0.65) return 'uncommon'
  return 'common'
}

function affixPool(item: ItemDef): (keyof GearStats)[] {
  const primary = item.combatStyle ? primaryForCombatStyle(item.combatStyle) : 'strength'
  if (item.armourType === 'jewelry') {
    return ['strength', 'agility', 'intellect', 'stamina', 'haste', 'crit', 'mastery']
  }
  return [primary, 'stamina', 'haste', 'crit', 'mastery']
}

/**
 * Rolls a crafted instance. Base stats are scaled by quality, then 1–3 random
 * affixes are added from the piece's stat pool. `itemLevel` budgets the affix
 * values; the default is 1 so early crafts stay modest.
 */
export function rollGearStats(item: ItemDef, rand: () => number = Math.random): GearRoll {
  const quality = rollQuality(rand)
  const mult = QUALITY_MULTIPLIER[quality]
  const level = Math.max(1, item.itemLevel ?? 1)
  const base = item.stats ?? {}
  let stats = EMPTY_STATS
  for (const id of STAT_IDS) {
    const value = base[id] ?? 0
    if (value) stats = { ...stats, [id]: Math.max(1, Math.round(value * mult)) }
  }

  const affixes = quality === 'epic' ? 3 : quality === 'rare' ? 2 : quality === 'uncommon' ? 2 : 1
  const pool = affixPool(item)
  for (let i = 0; i < affixes; i++) {
    const id = pool[Math.floor(rand() * pool.length)]!
    const amount = Math.max(1, Math.round((1 + level * 0.8) * mult * (0.7 + rand() * 0.6)))
    stats = { ...stats, [id]: stats[id] + amount }
  }

  return {
    stats,
    quality,
    armour: Math.max(0, Math.round((item.armour ?? 0) * mult)),
    power: Math.max(0, Math.round((item.power ?? 0) * mult)),
  }
}

export function emptyStats(): GearStats {
  return { ...EMPTY_STATS }
}

/** A crafted piece's base stats, with every stat present (0 when absent). */
export function statsOf(item: ItemDef): GearStats {
  return addStats(EMPTY_STATS, item.stats ?? {})
}

/** Reads the stats JSON stored on a gear instance row. */
export function parseStats(json: string | null | undefined): GearStats {
  if (!json) return emptyStats()
  try {
    const raw = JSON.parse(json) as Partial<GearStats>
    return addStats(EMPTY_STATS, raw)
  } catch {
    return emptyStats()
  }
}

/** The gear score of a single piece. */
export function pieceScore(item: ItemDef, stats: GearStats, armour: number, power: number): number {
  return gearScore(stats, armour, power)
}

/** A short human label for a stat delta, e.g. `+4 Strength · +2 Crit`. */
export function statLabel(id: keyof GearStats): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

// --- equipment requirements (RuneScape-style) --------------------------------

/**
 * The combat level each item level demands. Bronze (1) is wearable from the
 * start; adamant (5) needs level 30. Higher item levels extrapolate at +5 each.
 * Crafting is always a step ahead of the combat gate: Smithing 35 can forge
 * adamant, but Defence 30 is needed to wear it.
 */
const REQUIREMENT_BY_ITEM_LEVEL: Record<number, number> = {
  1: 1,
  2: 5,
  3: 10,
  4: 20,
  5: 30,
}

export function requiredLevelFor(itemLevel: number): number {
  const level = Math.max(1, Math.round(itemLevel))
  return REQUIREMENT_BY_ITEM_LEVEL[level] ?? level * 5
}

/**
 * The skill that gates a piece: melee weapons train Attack, bows Ranged, staves
 * Magic; armour (and shields) train Defence; quivers, tomes and orbs gate on
 * their own combat style. Jewellery (rings, necks, trinkets) has no requirement.
 */
export function requirementSkill(item: ItemDef): SkillId | null {
  if (!item.slot) return null
  if (item.slot === 'mainHand') {
    const style = item.combatStyle ?? 'melee'
    if (style === 'ranged') return 'ranged'
    if (style === 'magic') return 'magic'
    return 'attack'
  }
  if (item.slot === 'offHand') {
    if (item.tags?.includes('shield')) return 'defence'
    const style = item.combatStyle ?? 'melee'
    if (style === 'ranged') return 'ranged'
    if (style === 'magic') return 'magic'
    return 'defence'
  }
  if (item.armourType === 'jewelry') return null
  return 'defence'
}

/** Explicit requirements, or the ones derived from the piece's slot and tier. */
export function itemRequirements(item: ItemDef): Partial<Record<SkillId, number>> {
  if (item.requirements) return item.requirements
  const skill = requirementSkill(item)
  if (!skill) return {}
  return { [skill]: requiredLevelFor(item.itemLevel ?? 1) }
}

export interface MissingRequirement {
  skill: SkillId
  /** The level the piece demands. */
  level: number
  /** The player's current level in that skill. */
  current: number
}

/** Whether the player's levels satisfy an item's requirements. */
export function meetsRequirements(
  item: ItemDef,
  levelOf: (skill: SkillId) => number,
): { ok: boolean; missing: MissingRequirement[] } {
  const requirements = itemRequirements(item)
  const missing: MissingRequirement[] = []
  for (const [skill, level] of Object.entries(requirements)) {
    if (level === undefined) continue
    const current = levelOf(skill as SkillId)
    if (current < level) missing.push({ skill: skill as SkillId, level, current })
  }
  return { ok: missing.length === 0, missing }
}
