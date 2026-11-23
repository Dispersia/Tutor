/**
 * Material **tier bands** (docs/DESIGN.md §13.5.3).
 *
 * Every craftable line runs along a material axis — plate (bronze → adamant),
 * leather (leather → hardened), cloth (cloth → silk → mystic), wood (oak → yew) and
 * jewellery (copper → arcane) — and each material is a *band*, not a skill per item.
 * A band owns **one** level track: its recipes unlock at thresholds inside the band,
 * and *any* item of the band feeds the same score, so you never level a dozen
 * near-identical actions to move on.
 *
 * A band's gear is all unlocked by `gearUnlockLevel`; past that the band keeps going
 * to 100 and pays out two things that keep it live forever:
 *
 *  - a **per-level passive** for the whole account (`buff`), and
 *  - a **reagent** (`reagent`) that deep salvage yields and Enchanting spends to put
 *    the band's signature stat (`enchant`) on any higher-tier piece.
 *
 * Non-entry tiers carry an `after` gate, so steel's whole band only opens once bronze
 * has reached 40 — the tier chain without a per-action rule.
 *
 * This module deliberately does not import `skills.ts`: band ids are plain strings so
 * `skills.ts` can depend on it without a cycle.
 */

import { curveLevelInfo, curveXpForLevel, type LevelCurve } from './curve'

/** A crafting line — the family whose tiers form one axis. */
export type BandLine = 'plate' | 'leather' | 'cloth' | 'wood' | 'jewelry'

export type BandId =
  // plate (Smithing)
  | 'bronze'
  | 'iron'
  | 'steel'
  | 'mythril'
  | 'adamant'
  // leather (Leatherworking)
  | 'leather'
  | 'hardened'
  // cloth (Tailoring)
  | 'cloth'
  | 'silk'
  | 'mystic'
  // wood (Fletching)
  | 'oak'
  | 'willow'
  | 'yew'
  // jewellery (Crafting)
  | 'copper'
  | 'sapphire'
  | 'arcane'

/** A combat stat a band can passively grant, or an enchant can add. */
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
  /** the tier position inside its line (1..n) */
  tier: number
  /** the reagent Enchanting spends; produced by salvaging this band's gear */
  reagent: string
  /** the level a band's gear is fully unlocked by; the band still runs to 100 */
  gearUnlockLevel: number
  /** the account-wide passive this band grants per level (`value` is a fraction) */
  buff: { stat: BandStat; value: number; label: string }
  /** what one reagent enchant adds to a piece */
  enchant: { stat: BandStat; value: number; label: string }
  /** Enchanting level needed to spend this band's reagent */
  enchantLevel: number
  /** the band that must reach `level` before this one opens at all */
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
  // plate — Smithing
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
  // leather — Leatherworking
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
  // cloth — Tailoring
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
  // wood — Fletching
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
  // jewellery — Crafting + Enchanting
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

/** `100 + (level−1)·10` per level — the same curve an action uses (§13.5). */
export function bandXpForLevel(level: number): number {
  return curveXpForLevel(BAND_CURVE, Math.max(1, Math.round(level)))
}

export const BAND_MAX_LEVEL = 100

const BAND_CURVE: LevelCurve = { base: 100, step: 10, max: BAND_MAX_LEVEL }

/** Total XP to reach a band level (mirrors the action ladder). */
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

/** Level info for a band's summed XP, capped at 100 (progress pinned at 100%). */
export function bandLevelInfo(xp: number): BandLevelInfo {
  return curveLevelInfo(BAND_CURVE, xp)
}

/** The passive a set of band levels grants (all values are fractions/flat as labelled). */
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
    // Level 1 is the floor, so the passive scales from level 2 up — exactly like an
    // action's own passive, which pays `value · (level − 1)`.
    out[band.buff.stat] += band.buff.value * (level - 1)
  }
  return out
}
