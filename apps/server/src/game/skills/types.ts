/**
 * Profession and gear contracts (docs/DESIGN.md §13.5).
 *
 * Types only — the vocabulary every module in this folder speaks, so a leaf
 * module can import it without a cycle through the barrel.
 */

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
  | 'crafting'
  | 'leatherworking'
  | 'tailoring'
  | 'firemaking'
  | 'construction'
  | 'enchanting'
  | 'thieving'
  | 'agility'
  | 'attack'
  | 'strength'
  | 'defence'
  | 'constitution'
  | 'ranged'
  | 'magic'
  | 'prayer'
  | 'slayer'

export type SkillCategory = 'gathering' | 'artisan' | 'support' | 'combat'

/** A passive bonus. `value` is a fraction (0.01 = +1%). */
export type ModKind = 'yield' | 'double' | 'xp' | 'global_xp' | 'damage' | 'drop' | 'hp' | 'coins'

export interface Mod {
  kind: ModKind
  value: number
  /** scope for yield/double/xp (defaults to the owning skill) */
  skill?: SkillId
  /**
   * Cross-profession synergy: when set, `value` is **multiplied by this skill's
   * derived level** before it is applied to `skill`. So a talent with
   * `{ kind: 'xp', value: 0.005, skill: 'smithing', synergy: 'mining' }` gives
   * Smithing +0.5% XP per point of Mining level. This is how professions feed each
   * other's progression, not just each other's materials.
   */
  synergy?: SkillId
}

export interface SkillDef {
  id: SkillId
  name: string
  category: SkillCategory
  icon: string
  description: string
  /** gained every level (multiplied by level-1) */
  effect: Mod
  /** human description of the per-level effect */
  effectLabel: string
}

// --- gear stats (WoW-style primaries + secondaries) --------------------------

/**
 * The primary stats decide which combat style a piece is built for:
 * Strength → melee, Agility → ranged, Intellect → magic. Stamina is raw HP.
 * The secondaries are rating-style: Haste, Crit and Mastery convert to
 * percentages and make the same weapon hit harder or more often.
 */
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

/** Which combat style a piece of gear is intended for. */
export type CombatStyle = 'melee' | 'ranged' | 'magic' | 'general'

export interface ItemDef {
  id: string
  name: string
  icon: string
  description: string
  tier: 'raw' | 'refined' | 'equipment' | 'consumable' | 'coin' | 'other'
  slot?: Slot
  tags?: string[]
  /** weapon power (added to your combat power when equipped) */
  power?: number
  /** armour (reduces incoming monster damage when equipped) */
  armour?: number
  /** food: HP restored when auto-eaten in combat */
  heal?: number
  /** potion: a buff applied for the whole fight */
  buff?: { kind: 'power' | 'maxHp'; value: number }
  /** which armour family the piece belongs to (crafting + set bonuses) */
  armourType?: ArmourType
  /** the combat style the piece is built for */
  combatStyle?: CombatStyle
  /** fixed base stats; crafting adds random affixes on top */
  stats?: Partial<GearStats>
  /** rough item level, used to budget random affixes */
  itemLevel?: number
  /**
   * Stat levels needed to wear the piece. When absent it is derived from the
   * slot, combat style and item level (weapons → Attack/Ranged/Magic, armour →
   * Defence), so high-tier gear cannot be worn without the combat training for it.
   */
  requirements?: Partial<Record<SkillId, number>>
  /** coin value (§13.5.3.2): drives the Distill XP an item is worth, and selling */
  value?: number
}

/**
 * The worn slots. The weapon slot is `mainHand`; the off hand takes a shield,
 * quiver, tome or orb. Two ring and two trinket slots let jewellery matter.
 */
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

/** One weighted outcome of a `table` action (a prospecting loot roll, §13.5.3.1). */
export interface LootEntry {
  item: string
  /** units on a hit (default 1) */
  count?: number
  /** relative weight; picks are `weight / totalWeight` */
  weight: number
}

/** One recipe a "choose the input" action can run (§13.5.3.1). */
export interface ActionChoice {
  id: string
  /** label in the picker, e.g. `Copper ore` */
  label: string
  consumes?: Cost[]
  produces?: Cost[]
  table?: LootEntry[]
  /** overrides the action's odds for this input */
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
  /** profession XP awarded on a correct answer (before modifiers); a rig also
   *  pays `IDLE.xpPerCraft` per craft it completes on its own (§13.5.1) */
  xp: number
  /** optional card filter by deck level */
  deckLevel?: string
  minScore?: number
  requires?: UnlockReq[]
  /**
   * Tier band this action belongs to (§13.5.3). Every action of a band feeds the
   * same **band score**, and the action unlocks at `bandLevel` inside it. Gear
   * recipes use this instead of a per-action smithing level, so a whole metal's
   * set reads as one progress track.
   */
  band?: BandId
  /** the band score at which this action unlocks (default 1) */
  bandLevel?: number
  /** chance a craft yields its output (1 = always); a prospect can miss (§13.5.3.1) */
  successChance?: number
  /** added to `successChance` per action level, capped at 1 — skill beats the odds */
  successPerLevel?: number
  consumes?: Cost[]
  produces?: Cost[]
  /**
   * Weighted gem table (§13.5.3.1). A `table` action rolls **one** entry instead of
   * its `produces`, so a whole ore tier's gems share a single action — and a single
   * level — however many gem types the table holds.
   */
  table?: LootEntry[]
  /**
   * Recipes this action lets you **choose** between (§13.5.3.1): prospect any ore
   * you hold, cut any rough gem of a tier. The action still levels as one, so the
   * choice is a parameter, not a separate action.
   */
  choices?: ActionChoice[]
  /** must have an equipped item in `slot` carrying `tag` */
  equip?: { slot: Slot; tag: string }
}

export interface SkillLevelInfo {
  level: number
  intoLevel: number
  forNext: number
  progress: number
}
