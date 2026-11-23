import type { BandId, BandStat } from '../bands'
import type { GearStats } from './types'

export type GemType = 'ruby' | 'emerald' | 'sapphire'

export interface GemTypeDef {
  id: GemType
  name: string
  icon: string
  stat: BandStat
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
  word: string
  ore: string
  band: BandId
  metalBand: string
}

export const GEM_TIERS: GemTierDef[] = [
  { tier: 1, word: 'Cracked', ore: 'copper_ore', band: 'copper', metalBand: 'bronze_band' },
  { tier: 2, word: 'Chipped', ore: 'iron_ore', band: 'sapphire', metalBand: 'iron_band' },
  { tier: 3, word: 'Perfect', ore: 'mythril_ore', band: 'arcane', metalBand: 'mythril_band' },
]

export const gemId = (type: GemType, tier: number) => `${type}${tier}`
export const uncutGemId = (type: GemType, tier: number) => `uncut_${type}${tier}`
export const dustId = (type: GemType) => `${type}_dust`

export function gemRingStats(g: GemTypeDef, t: GemTierDef): Partial<GearStats> {
  const stats: Partial<GearStats> = { stamina: t.tier }
  if (g.stat === 'crit' || g.stat === 'haste' || g.stat === 'mastery') {
    stats[g.stat] = 1 + t.tier
  }
  return stats
}
