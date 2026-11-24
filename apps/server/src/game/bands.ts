import { curveLevelInfo, curveXpForLevel, type LevelCurve } from './curve'

export type BandLine = 'plate' | 'leather' | 'cloth' | 'wood' | 'jewelry'

export type BandId =
  | 'bronze'
  | 'iron'
  | 'steel'
  | 'mythril'
  | 'adamant'
  | 'leather'
  | 'hardened'
  | 'cloth'
  | 'silk'
  | 'mystic'
  | 'oak'
  | 'willow'
  | 'yew'
  | 'copper'
  | 'sapphire'
  | 'arcane'

export type BandStat = 'crit' | 'haste' | 'mastery' | 'stamina' | 'lifesteal'

const BUFF_VALUE: Record<BandStat, number> = {
  crit: 0.002,
  haste: 0.0015,
  mastery: 0.002,
  lifesteal: 0.0008,
  stamina: 0.04,
}
const BUFF_LABEL: Record<BandStat, string> = {
  crit: '+0.2% crit/level',
  haste: '+0.15% haste/level',
  mastery: '+0.2% mastery/level',
  lifesteal: '+0.08% lifesteal/level',
  stamina: '+0.04 stamina/level',
}
const ENCHANT_VALUE: Record<BandStat, number> = {
  crit: 0.03,
  haste: 0.03,
  mastery: 0.04,
  lifesteal: 0.02,
  stamina: 6,
}
const ENCHANT_LABEL: Record<BandStat, string> = {
  crit: '+3% crit',
  haste: '+3% haste',
  mastery: '+4% mastery',
  lifesteal: '+2% lifesteal',
  stamina: '+6 stamina',
}

export interface BandDef {
  id: BandId
  line: BandLine
  name: string
  icon: string
  tier: number
  reagent: string
  gearUnlockLevel: number
  buff: { stat: BandStat; value: number; label: string }
  enchant: { stat: BandStat; value: number; label: string }
  enchantLevel: number
  after?: { band: BandId; level: number }
}

interface BandSpec {
  line: BandLine
  tier: number
  id: BandId
  name: string
  icon: string
  stat: BandStat
  after?: BandDef['after']
}

function bandDef(spec: BandSpec): BandDef {
  const { id, stat, tier } = spec
  return {
    id,
    line: spec.line,
    tier,
    name: spec.name,
    icon: spec.icon,
    reagent: `${id}_reagent`,
    gearUnlockLevel: 40,
    buff: { stat, value: BUFF_VALUE[stat], label: BUFF_LABEL[stat] },
    enchant: { stat, value: ENCHANT_VALUE[stat], label: ENCHANT_LABEL[stat] },
    enchantLevel: tier * 5,
    after: spec.after,
  }
}

export const BANDS: BandDef[] = [
  bandDef({ line: 'plate', tier: 1, id: 'bronze', name: 'Bronze', icon: '🟫', stat: 'crit' }),
  bandDef({
    line: 'plate',
    tier: 2,
    id: 'iron',
    name: 'Iron',
    icon: '⬜',
    stat: 'lifesteal',
    after: { band: 'bronze', level: 40 },
  }),
  bandDef({
    line: 'plate',
    tier: 3,
    id: 'steel',
    name: 'Steel',
    icon: '🔩',
    stat: 'haste',
    after: { band: 'iron', level: 40 },
  }),
  bandDef({
    line: 'plate',
    tier: 4,
    id: 'mythril',
    name: 'Mythril',
    icon: '🔹',
    stat: 'mastery',
    after: { band: 'steel', level: 40 },
  }),
  bandDef({
    line: 'plate',
    tier: 5,
    id: 'adamant',
    name: 'Adamant',
    icon: '🔷',
    stat: 'stamina',
    after: { band: 'mythril', level: 40 },
  }),
  bandDef({ line: 'leather', tier: 1, id: 'leather', name: 'Leather', icon: '🟤', stat: 'crit' }),
  bandDef({
    line: 'leather',
    tier: 2,
    id: 'hardened',
    name: 'Hardened',
    icon: '🟫',
    stat: 'lifesteal',
    after: { band: 'leather', level: 40 },
  }),
  bandDef({ line: 'cloth', tier: 1, id: 'cloth', name: 'Cloth', icon: '🧵', stat: 'haste' }),
  bandDef({
    line: 'cloth',
    tier: 2,
    id: 'silk',
    name: 'Silk',
    icon: '🕸️',
    stat: 'mastery',
    after: { band: 'cloth', level: 40 },
  }),
  bandDef({
    line: 'cloth',
    tier: 3,
    id: 'mystic',
    name: 'Mystic',
    icon: '🔮',
    stat: 'stamina',
    after: { band: 'silk', level: 40 },
  }),
  bandDef({ line: 'wood', tier: 1, id: 'oak', name: 'Oak', icon: '🪵', stat: 'crit' }),
  bandDef({
    line: 'wood',
    tier: 2,
    id: 'willow',
    name: 'Willow',
    icon: '🌿',
    stat: 'haste',
    after: { band: 'oak', level: 40 },
  }),
  bandDef({
    line: 'wood',
    tier: 3,
    id: 'yew',
    name: 'Yew',
    icon: '🎋',
    stat: 'mastery',
    after: { band: 'willow', level: 40 },
  }),
  bandDef({ line: 'jewelry', tier: 1, id: 'copper', name: 'Copper', icon: '🟠', stat: 'stamina' }),
  bandDef({
    line: 'jewelry',
    tier: 2,
    id: 'sapphire',
    name: 'Sapphire',
    icon: '🔷',
    stat: 'crit',
    after: { band: 'copper', level: 40 },
  }),
  bandDef({
    line: 'jewelry',
    tier: 3,
    id: 'arcane',
    name: 'Arcane',
    icon: '💠',
    stat: 'lifesteal',
    after: { band: 'sapphire', level: 40 },
  }),
]

export const BAND_BY_ID = new Map<BandId, BandDef>(BANDS.map((b) => [b.id, b]))

export function bandXpForLevel(level: number): number {
  return curveXpForLevel(BAND_CURVE, Math.max(1, Math.round(level)))
}

export const BAND_MAX_LEVEL = 100

const BAND_CURVE: LevelCurve = { base: 50, step: 0.25, power: 2, max: BAND_MAX_LEVEL }

export function bandXpToLevel(level: number): number {
  let total = 0
  for (let i = 1; i < level; i++) total += bandXpForLevel(i)
  return total
}

export interface BandLevelInfo {
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

export function bandLevelInfo(xp: number): BandLevelInfo {
  return curveLevelInfo(BAND_CURVE, xp)
}

export interface BandBonuses {
  crit: number
  haste: number
  mastery: number
  stamina: number
  lifesteal: number
}

export function bandBonuses(levels: Map<BandId, number>): BandBonuses {
  const out: BandBonuses = { crit: 0, haste: 0, mastery: 0, stamina: 0, lifesteal: 0 }
  for (const band of BANDS) {
    const level = levels.get(band.id) ?? 0
    if (level <= 1) continue
    out[band.buff.stat] += band.buff.value * (level - 1)
  }
  return out
}
