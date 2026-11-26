import type { BandId } from '../bands'

export type SkillId =
  | 'mining'
  | 'woodcutting'
  | 'fishing'
  | 'farming'
  | 'smithing'
  | 'cooking'
  | 'herblore'
  | 'fletching'
  | 'runecrafting'
  | 'jewelcrafting'
  | 'leatherworking'
  | 'tailoring'
  | 'enchanting'
  | 'thieving'
  | 'agility'
  | 'attack'
  | 'strength'
  | 'ranged'
  | 'magic'

export type SkillCategory = 'gathering' | 'artisan' | 'support' | 'combat'

export type ModKind = 'yield' | 'double' | 'xp' | 'global_xp' | 'damage' | 'drop' | 'hp' | 'coins'

export interface Mod {
  kind: ModKind
  value: number
  skill?: SkillId
  synergy?: SkillId
}

export interface SkillDef {
  id: SkillId
  name: string
  category: SkillCategory
  icon: string
  description: string
  effect: Mod
  effectLabel: string
}

export type PrimaryStat = 'strength' | 'agility' | 'intellect'
export type SecondaryStat = 'haste' | 'crit' | 'mastery'
export type GearStatId = PrimaryStat | SecondaryStat | 'stamina'

export interface GearStats {
  strength: number
  agility: number
  intellect: number
  stamina: number
  haste: number
  crit: number
  mastery: number
}

export type ArmourType = 'plate' | 'leather' | 'cloth' | 'jewelry'

export type GearQuality = 'common' | 'uncommon' | 'rare' | 'epic'

export type CombatStyle = 'melee' | 'ranged' | 'magic' | 'general'

export interface ItemDef {
  id: string
  name: string
  icon: string
  description: string
  tier: 'raw' | 'refined' | 'equipment' | 'consumable' | 'coin' | 'other'
  slot?: Slot
  tags?: string[]
  power?: number
  armour?: number
  heal?: number
  buff?: { kind: 'power' | 'maxHp'; value: number }
  armourType?: ArmourType
  combatStyle?: CombatStyle
  stats?: Partial<GearStats>
  itemLevel?: number
  requirements?: Partial<Record<SkillId, number>>
  value?: number
}

export type Slot =
  | 'mainHand'
  | 'offHand'
  | 'head'
  | 'neck'
  | 'chest'
  | 'waist'
  | 'legs'
  | 'feet'
  | 'hands'
  | 'ring1'
  | 'ring2'
  | 'trinket1'
  | 'trinket2'

export interface Cost {
  item: string
  count: number
}

export interface LootEntry {
  item: string
  count?: number
  weight: number
}

export interface ActionChoice {
  id: string
  label: string
  consumes?: Cost[]
  produces?: Cost[]
  table?: LootEntry[]
  successChance?: number
  successPerLevel?: number
}

export interface UnlockReq {
  skill: SkillId
  level: number
}

export interface ActionDef {
  id: string
  skillId: SkillId
  name: string
  description: string
  tier: number
  xp: number
  deckLevel?: string
  minScore?: number
  requires?: UnlockReq[]
  band?: BandId
  bandLevel?: number
  successChance?: number
  successPerLevel?: number
  consumes?: Cost[]
  produces?: Cost[]
  table?: LootEntry[]
  choices?: ActionChoice[]
  equip?: { slot: Slot; tag: string }
}

export interface SkillLevelInfo {
  level: number
  intoLevel: number
  forNext: number
  progress: number
}
