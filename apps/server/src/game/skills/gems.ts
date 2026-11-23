/**
 * Gem types and tiers (docs/DESIGN.md §13.5.3.1) — content and its helpers.
 */

import type { BandId, BandStat } from '../bands'
import type { GearStats } from './types'

// --- gems (docs/DESIGN.md §13.5.3.1) -----------------------------------------
//
// A gem **type** is its stat, the same at every tier (ruby always crit). A gem
// **tier** is the ore it was prospected from, and one ore can drop any type of its
// tier. Gems flow: ore → rough gem → cut gem → set into a band / crushed to dust
// (for Enchanting).

export type GemType = 'ruby' | 'emerald' | 'sapphire'

export interface GemTypeDef {
  id: GemType
  name: string
  icon: string
  /** the combat stat every gem of this type grants */
  stat: BandStat
  /** what one enchant of this gem adds to a piece */
  value: number
  label: string
}

export const GEM_TYPES: GemTypeDef[] = [
  { id: 'ruby', name: 'Ruby', icon: '❣️', stat: 'crit', value: 0.03, label: '+3% crit' },
  { id: 'emerald', name: 'Emerald', icon: '🟢', stat: 'haste', value: 0.03, label: '+3% haste' },
  {
    id: 'sapphire',
    name: 'Sapphire',
    icon: '🔵',
    stat: 'mastery',
    value: 0.04,
    label: '+4% mastery',
  },
]

export interface GemTierDef {
  tier: number
  /** the quality word in the gem's name */
  word: string
  /** the ore this tier is prospected from */
  ore: string
  /** the jewellery band this tier feeds, and the metal ring base it sets into */
  band: BandId
  metalBand: string
}

export const GEM_TIERS: GemTierDef[] = [
  { tier: 1, word: 'Cracked', ore: 'copper_ore', band: 'copper', metalBand: 'bronze_band' },
  { tier: 2, word: 'Chipped', ore: 'iron_ore', band: 'sapphire', metalBand: 'iron_band' },
  { tier: 3, word: 'Perfect', ore: 'mythril_ore', band: 'arcane', metalBand: 'mythril_band' },
]

export const GEM_BY_TYPE = new Map(GEM_TYPES.map((g) => [g.id, g]))
export const GEM_BY_TIER = new Map(GEM_TIERS.map((t) => [t.tier, t]))

export const gemId = (type: GemType, tier: number) => `${type}${tier}`
export const uncutGemId = (type: GemType, tier: number) => `uncut_${type}${tier}`
export const dustId = (type: GemType) => `${type}_dust`

/** The stat block a gem gives when set into a ring. */
export function gemRingStats(g: GemTypeDef, t: GemTierDef): Partial<GearStats> {
  const stats: Partial<GearStats> = { stamina: t.tier }
  if (g.stat === 'crit' || g.stat === 'haste' || g.stat === 'mastery') {
    stats[g.stat] = 1 + t.tier
  }
  return stats
}
