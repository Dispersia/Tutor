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

export function gearScore(stats: GearStats, armour: number, power: number): number {
  return Math.round(sumStats(stats) + armour * 2 + power * 2)
}

export interface SetBonusTier {
  pieces: number
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
  pieces: number
  active: SetBonusTier[]
  next: SetBonusTier | null
}

export function activeSetBonuses(counts: Partial<Record<ArmourType, number>>): ActiveSetBonus[] {
  return GEAR_SETS.map((set) => {
    const pieces = counts[set.armourType] ?? 0
    const active = set.tiers.filter((tier) => pieces >= tier.pieces)
    const next = set.tiers.find((tier) => pieces < tier.pieces) ?? null
    return { id: set.id, name: set.name, armourType: set.armourType, pieces, active, next }
  }).filter((set) => set.pieces > 0)
}

export function applySetBonuses(
  stats: GearStats,
  armour: number,
  power: number,
  sets: ActiveSetBonus[],
): { stats: GearStats; armour: number; power: number } {
  let totals = { stats, armour, power }
  for (const set of sets) for (const tier of set.active) totals = applyTier(totals, tier)
  return {
    stats: totals.stats,
    armour: Math.round(totals.armour),
    power: Math.round(totals.power),
  }
}

type SetTier = ActiveSetBonus['active'][number]

function applyTier(
  totals: { stats: GearStats; armour: number; power: number },
  tier: SetTier,
): { stats: GearStats; armour: number; power: number } {
  return {
    stats: tier.stats ? addStats(totals.stats, tier.stats) : totals.stats,
    armour: tier.armourPct ? totals.armour * (1 + tier.armourPct) : totals.armour,
    power: tier.powerPct ? totals.power * (1 + tier.powerPct) : totals.power,
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
  primary: number
  crit: number
  haste: number
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

export function rollGearStats(item: ItemDef, rand: () => number = Math.random): GearRoll {
  const quality = rollQuality(rand)
  const mult = QUALITY_MULTIPLIER[quality]
  const level = Math.max(1, item.itemLevel ?? 1)
  const stats = addAffixes({
    stats: scaledBase(item, mult),
    count: affixCount(quality),
    pool: affixPool(item),
    level,
    mult,
    rand,
  })
  return {
    stats,
    quality,
    armour: scaled(item.armour ?? 0, mult),
    power: scaled(item.power ?? 0, mult),
  }
}

const scaled = (value: number, mult: number): number => Math.max(0, Math.round(value * mult))

function scaledBase(item: ItemDef, mult: number): GearStats {
  const base = item.stats ?? {}
  let stats = EMPTY_STATS
  for (const id of STAT_IDS) {
    const value = base[id] ?? 0
    if (value) stats = { ...stats, [id]: Math.max(1, Math.round(value * mult)) }
  }
  return stats
}

const affixCount = (quality: GearQuality): number =>
  quality === 'epic' ? 3 : quality === 'rare' || quality === 'uncommon' ? 2 : 1

interface AffixReq {
  stats: GearStats
  count: number
  pool: (keyof GearStats)[]
  level: number
  mult: number
  rand: () => number
}

function addAffixes(req: AffixReq): GearStats {
  let stats = req.stats
  for (let i = 0; i < req.count; i++) {
    const id = req.pool[Math.floor(req.rand() * req.pool.length)]!
    const amount = Math.max(
      1,
      Math.round((1 + req.level * 0.8) * req.mult * (0.7 + req.rand() * 0.6)),
    )
    stats = { ...stats, [id]: stats[id] + amount }
  }
  return stats
}

export function emptyStats(): GearStats {
  return { ...EMPTY_STATS }
}

export function statsOf(item: ItemDef): GearStats {
  return addStats(EMPTY_STATS, item.stats ?? {})
}

export function parseStats(json: string | null | undefined): GearStats {
  if (!json) return emptyStats()
  try {
    const raw = JSON.parse(json) as Partial<GearStats>
    return addStats(EMPTY_STATS, raw)
  } catch {
    return emptyStats()
  }
}

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

export function itemRequirements(item: ItemDef): Partial<Record<SkillId, number>> {
  if (item.requirements) return item.requirements
  const skill = requirementSkill(item)
  if (!skill) return {}
  return { [skill]: requiredLevelFor(item.itemLevel ?? 1) }
}

export interface MissingRequirement {
  skill: SkillId
  level: number
  current: number
}

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
