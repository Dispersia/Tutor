/**
 * Professions (docs/DESIGN.md §13.5).
 *
 * Normal RuneScape/WoW-style skills. Actions are *not* tied to an exercise type:
 * training an action gives you "the next drill", and a correct answer awards that
 * profession's XP + materials. Gathering skills produce raw materials, artisan
 * skills consume them, and combat skills require equipment forged by the artisans.
 * A completed drill also powers the action's **idle rig** (docs §13.5.1), which goes
 * on earning XP and materials by the clock until its run drains out.
 */

import { BAND_BY_ID, BANDS } from './bands'
import type { BandId, BandStat } from './bands'

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

/** The worn slots, in paper-doll order. */
export const SLOTS: { id: Slot; label: string; icon: string; family: Slot[] }[] = [
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

/** Which slots an item may be worn in (rings and trinkets share a family). */
export function slotFamily(slot: Slot): Slot[] {
  return SLOTS.find((s) => s.id === slot)?.family ?? [slot]
}

/** The armour family a combat style wears. */
export function armourTypeForStyle(style: CombatStyle): ArmourType {
  if (style === 'ranged') return 'leather'
  if (style === 'magic') return 'cloth'
  if (style === 'melee') return 'plate'
  return 'jewelry'
}

/** The primary stat a combat style scales with. */
export function primaryStatForStyle(style: CombatStyle): PrimaryStat {
  if (style === 'ranged') return 'agility'
  if (style === 'magic') return 'intellect'
  return 'strength'
}

/** The combat style a weapon tag trains. */
export function combatStyleForTags(tags: string[] | undefined): CombatStyle {
  if (tags?.includes('bow')) return 'ranged'
  if (tags?.includes('staff')) return 'magic'
  return 'melee'
}

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

// --- skill XP curve ----------------------------------------------------------

/**
 * XP to advance one **action** level. Kept linear so the level-100 cap stays
 * reachable, but scaled for the idle era: a rig left running earns XP on its own
 * (every craft pays, docs §13.5.1), so the whole curve sits 10× higher than the
 * drill-only days — ~58.4k XP maxes one action, and a whole 4-action profession
 * is ~234k. A full 3-hour run of a maxed rig is worth ~2.7k XP, so capping an
 * action is ~22 "leave it running" sessions, not one.
 */
export function skillXpForLevel(level: number): number {
  return 100 + (level - 1) * 10
}

export interface SkillLevelInfo {
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

export function skillLevelInfo(xp: number): SkillLevelInfo {
  let level = 1
  let remaining = Math.max(0, xp)
  while (remaining >= skillXpForLevel(level)) {
    remaining -= skillXpForLevel(level)
    level++
  }
  const forNext = skillXpForLevel(level)
  return { level, intoLevel: remaining, forNext, progress: Math.min(1, remaining / forNext) }
}

/**
 * The most any **action** can reach. The profession level is the mean of its
 * actions, so this cap is what makes a profession read out of 100: a maxed
 * 4-action profession is level 100, and adding a 5th action lowers it again.
 */
export const ACTION_MAX_LEVEL = 100

/** An action's level info, capped at `ACTION_MAX_LEVEL` (progress pinned at 100%). */
export function actionLevelInfo(xp: number): SkillLevelInfo {
  const info = skillLevelInfo(xp)
  if (info.level < ACTION_MAX_LEVEL) return info
  return {
    level: ACTION_MAX_LEVEL,
    intoLevel: info.forNext,
    forNext: info.forNext,
    progress: 1,
  }
}

// --- professions -------------------------------------------------------------

const gather = (id: SkillId, name: string, icon: string, thing: string): SkillDef => ({
  id,
  name,
  category: 'gathering',
  icon,
  description: `Gather ${thing}.`,
  effect: { kind: 'yield', value: 0.01, skill: id },
  effectLabel: `+1% ${thing} gathered per level`,
})

const artisan = (id: SkillId, name: string, icon: string, verb: string): SkillDef => ({
  id,
  name,
  category: 'artisan',
  icon,
  description: `${verb}.`,
  effect: { kind: 'double', value: 0.005, skill: id },
  effectLabel: `+0.5% chance of a bonus product per level`,
})

const combat = (id: SkillId, name: string, icon: string, desc: string): SkillDef => ({
  id,
  name,
  category: 'combat',
  icon,
  description: desc,
  effect: { kind: 'damage', value: 0.01 },
  effectLabel: `+1% combat power per level`,
})

export const SKILLS: SkillDef[] = [
  // gathering
  gather('mining', 'Mining', '⛏️', 'ore and rune essence'),
  gather('woodcutting', 'Woodcutting', '🪓', 'logs'),
  gather('fishing', 'Fishing', '🎣', 'raw fish'),
  gather('farming', 'Farming', '🌱', 'herbs'),
  // artisan
  artisan('smithing', 'Smithing', '🔨', 'Smelt bars and forge weapons & armour'),
  artisan('cooking', 'Cooking', '🍳', 'Cook fish into food'),
  artisan('herblore', 'Herblore', '🧪', 'Brew herbs into potions'),
  artisan('fletching', 'Fletching', '🏹', 'Carve logs into bows and arrows'),
  artisan('runecrafting', 'Runecrafting', '🔮', 'Bind essence into runes'),
  artisan('crafting', 'Crafting', '💎', 'Cut gems, make vials and jewellery'),
  artisan('leatherworking', 'Leatherworking', '🟫', 'Tan hides into leather and ranged armour'),
  artisan('tailoring', 'Tailoring', '🧵', 'Weave cloth into robes and magic armour'),
  artisan('firemaking', 'Firemaking', '🔥', 'Burn logs to ash'),
  artisan('construction', 'Construction', '🏠', 'Turn logs into planks and furniture'),
  artisan(
    'enchanting',
    'Enchanting',
    '🔯',
    'Bind cut gems and runes into gear that grows stronger',
  ),
  // support
  {
    id: 'thieving',
    name: 'Thieving',
    category: 'support',
    icon: '🗝️',
    description: 'Steal coins and gems.',
    effect: { kind: 'coins', value: 0.02, skill: 'thieving' },
    effectLabel: '+2% coins stolen per level',
  },
  {
    id: 'agility',
    name: 'Agility',
    category: 'support',
    icon: '🏃',
    description: 'Train speed of recall.',
    effect: { kind: 'global_xp', value: 0.005 },
    effectLabel: '+0.5% XP to every profession per level',
  },
  // combat
  combat('attack', 'Attack', '⚔️', 'Melee accuracy and power.'),
  combat('strength', 'Strength', '💪', 'Melee damage.'),
  {
    id: 'defence',
    name: 'Defence',
    category: 'combat',
    icon: '🛡️',
    description: 'Wear armour and endure.',
    effect: { kind: 'hp', value: 0.01 },
    effectLabel: '+1% durability per level',
  },
  {
    id: 'constitution',
    name: 'Constitution',
    category: 'combat',
    icon: '❤️',
    description: 'Endurance.',
    effect: { kind: 'hp', value: 0.01 },
    effectLabel: '+1% durability per level',
  },
  combat('ranged', 'Ranged', '🏹', 'Bows and arrows.'),
  combat('magic', 'Magic', '✨', 'Cast with runes.'),
  {
    id: 'prayer',
    name: 'Prayer',
    category: 'combat',
    icon: '🙏',
    description: 'Bury bones for divine favour.',
    effect: { kind: 'hp', value: 0.005 },
    effectLabel: '+0.5% durability per level',
  },
  {
    id: 'slayer',
    name: 'Slayer',
    category: 'combat',
    icon: '🗡️',
    description: 'Hunt for rare drops.',
    effect: { kind: 'drop', value: 0.01 },
    effectLabel: '+1% rare drop chance per level',
  },
]

// --- materials ---------------------------------------------------------------

function item(
  id: string,
  name: string,
  icon: string,
  tier: ItemDef['tier'],
  description = '',
  extra: Partial<ItemDef> = {},
): ItemDef {
  return { id, name, icon, tier, description, ...extra }
}

/**
 * A craftable piece of gear. `stats` are the guaranteed base stats; crafting
 * rolls extra affixes on top (see `game/gear.ts`). `armour` and `power` are the
 * flat defensive/offensive values the older combat maths already used.
 */
function gear(
  id: string,
  name: string,
  icon: string,
  slot: Slot,
  armourType: ArmourType,
  combatStyle: CombatStyle,
  stats: Partial<GearStats>,
  extra: Partial<ItemDef> = {},
): ItemDef {
  return item(id, name, icon, 'equipment', '', {
    slot,
    armourType,
    combatStyle,
    stats,
    tags: ['armour', armourType],
    ...extra,
  })
}

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
  { id: 'sapphire', name: 'Sapphire', icon: '🔵', stat: 'mastery', value: 0.04, label: '+4% mastery' },
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
function gemRingStats(g: GemTypeDef, t: GemTierDef): Partial<GearStats> {
  const stats: Partial<GearStats> = { stamina: t.tier }
  if (g.stat === 'crit' || g.stat === 'haste' || g.stat === 'mastery') {
    stats[g.stat] = 1 + t.tier
  }
  return stats
}

// --- distillation (docs/DESIGN.md §13.5.3.2) ---------------------------------
//
// Enchanting has **one** track, `Distill`: break down an item to learn from it.
// The more a thing is worth in coins, the more it teaches — at a percentage, so an
// endgame piece levels faster but never instantly. Breaking it down also yields the
// **essence** of its family, the reagent every enchant is built from.

export type EssenceId = 'metal' | 'cloth' | 'leather' | 'wood' | 'gem'

export const ESSENCES: { id: EssenceId; name: string; icon: string }[] = [
  { id: 'metal', name: 'Metal essence', icon: '🔩' },
  { id: 'cloth', name: 'Cloth essence', icon: '🧵' },
  { id: 'leather', name: 'Leather essence', icon: '🟫' },
  { id: 'wood', name: 'Wood essence', icon: '🪵' },
  { id: 'gem', name: 'Gem essence', icon: '💎' },
]

export const essenceId = (e: EssenceId) => `${e}_essence`

const ESSENCE_BY_FAMILY = new Set<EssenceId>(ESSENCES.map((e) => e.id))

/** Which essence an item distills into, by what it is made of. */
export function essenceFamily(item: ItemDef): EssenceId {
  if (item.tags?.includes('bow') || item.tags?.includes('staff')) return 'wood'
  if (item.armourType && ESSENCE_BY_FAMILY.has(item.armourType as EssenceId)) {
    return item.armourType as EssenceId
  }
  const id = item.id
  if (id.includes('log') || id === 'plank' || id === 'ash' || id.includes('dust') && id.includes('wood')) return 'wood'
  if (id === 'hide' || id.includes('leather')) return 'leather'
  if (id === 'wool' || id === 'cloth' || id.includes('silk') || id.includes('cloth')) return 'cloth'
  if (id.includes('gem') || id.includes('ruby') || id.includes('emerald') || id.includes('sapphire') || id.includes('dust')) return 'gem'
  if (id.includes('rune') || id.includes('essence') || id.includes('ore') || id.includes('bar') || id === 'coal') return 'metal'
  return 'metal'
}

/** An item's coin value: explicit when set, else derived from its kind and level. */
export function itemValue(item: ItemDef): number {
  if (item.value !== undefined) return item.value
  switch (item.tier) {
    case 'raw':
      return 2
    case 'refined':
      return 8
    case 'consumable':
      return 6
    case 'equipment':
      return 20 * Math.max(1, item.itemLevel ?? 1)
    default:
      return 1
  }
}

/**
 * Enchanting XP one coin of an item's value is worth when distilled (§13.5.3.2).
 *
 * The action curve costs **58,410 XP** to reach level 100 (`skillXpForLevel`), and
 * Enchanting should cap in **~10 days** of steady play. So the XP gain is priced at
 * `6 XP per coin`: distilling ~9,735 coins of value maxes it — about **975 coins a
 * day**. That keeps an endgame piece (≈100 coins) worth 600 XP, a real step but never
 * a free level, while junk still trickles in.
 */
export const DISTILL_XP_PER_VALUE = 6

/** Action XP the ladder costs from level 1 to level 100 (`ACTION_MAX_LEVEL`). */
export const ACTION_XP_TO_MAX = 58_410

// --- enchants (docs/DESIGN.md §13.5.3.2) -------------------------------------
//
// Enchants are catalogued by **slot** and unlocked at Enchanting levels. Each needs
// its own essence reagents, and applying one grants **no** XP — it is the payoff.

export interface EnchantDef {
  id: string
  name: string
  /** the equipment slot family it fits */
  slot: Slot
  stat: keyof GearStats
  /** flat points the enchant adds to the piece */
  value: number
  /** Enchanting level required */
  level: number
  reagents: Cost[]
}

/** The noun a slot's enchant names itself after. */
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

/** Which essence an enchant's stat wants (§13.5.3.2). */
function familyForStat(stat: keyof GearStats): EssenceId {
  if (stat === 'agility') return 'leather'
  if (stat === 'intellect') return 'cloth'
  if (stat === 'crit' || stat === 'haste' || stat === 'mastery') return 'gem'
  return 'metal'
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/**
 * The catalog: one enchant per `[slot, stat]`, its `level` the Enchanting gate. All
 * enchants of a slot sit together, so a slot's stat menu opens a piece at a time.
 * Levels run 2 → 50; cost and payoff scale with them.
 */
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
  const reagents: Cost[] = [
    { item: essenceId(family), count: Math.max(1, Math.round(level / 4)) },
  ]
  // A non-gem enchant also asks for a gem essence, so deeper enchants pull from two
  // families and Distill has to feed both.
  if (family !== 'gem') {
    reagents.push({ item: essenceId('gem'), count: Math.max(1, Math.round(level / 10)) })
  }
  // Weapons and off-hands also want wood (grips, frames, staves), so wood essence has
  // a home too.
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

/** The enchants that fit a piece's slot. */
export function enchantsForSlot(slot: Slot): EnchantDef[] {
  return ENCHANTS.filter((e) => e.slot === slot || slotFamily(e.slot).includes(slot))
}

export const ITEMS: ItemDef[] = [
  // ores + essence
  item('copper_ore', 'Copper ore', '🟠', 'raw'),
  item('tin_ore', 'Tin ore', '⚪', 'raw'),
  item('iron_ore', 'Iron ore', '🔘', 'raw'),
  item('coal', 'Coal', '⚫', 'raw'),
  item('mythril_ore', 'Mythril ore', '🔵', 'raw'),
  item('adamant_ore', 'Adamant ore', '🔷', 'raw'),
  item('rune_essence', 'Rune essence', '🔷', 'raw'),
  // logs
  item('yew_log', 'Yew log', '🪵', 'raw'),
  item('oak_log', 'Oak log', '🪵', 'raw'),
  item('willow_log', 'Willow log', '🪵', 'raw'),
  item('maple_log', 'Maple log', '🪵', 'raw'),
  // fish
  item('raw_shrimp', 'Raw shrimp', '🦐', 'raw'),
  item('raw_trout', 'Raw trout', '🐟', 'raw'),
  item('raw_lobster', 'Raw lobster', '🦞', 'raw'),
  // herbs
  item('guam', 'Guam', '🌿', 'raw'),
  item('tarromin', 'Tarromin', '🌿', 'raw'),
  item('harralander', 'Harralander', '🌿', 'raw'),
  item('ranarr', 'Ranarr', '🌿', 'raw'),
  // cloth fibres
  item('wool', 'Wool', '🧶', 'raw'),
  item('silk', 'Silk', '🕸️', 'raw'),
  // refined
  item('bronze_bar', 'Bronze bar', '🟫', 'refined'),
  item('iron_bar', 'Iron bar', '⬜', 'refined'),
  item('steel_bar', 'Steel bar', '🔩', 'refined'),
  item('mythril_bar', 'Mythril bar', '🔹', 'refined'),
  item('adamant_bar', 'Adamant bar', '🔷', 'refined'),
  // band reagents (§13.5.3): deep salvage yields one, Enchanting spends it to put
  // the band's signature stat on a higher-tier piece.
  ...BANDS.map((b) =>
    item(b.reagent, `${b.name} reagent`, '✨', 'refined', `Enchants a piece with ${b.enchant.label}.`),
  ),
  // ring bands (§13.5.3.1): Smithing forges the metal, Jewellery sets the gem.
  item('bronze_band', 'Bronze band', '💍', 'refined', 'A plain metal ring base.'),
  item('iron_band', 'Iron band', '💍', 'refined', 'A sturdier ring base.'),
  item('mythril_band', 'Mythril band', '💍', 'refined', 'A fine ring base for precious stones.'),
  item('cooked_shrimp', 'Cooked shrimp', '🍤', 'consumable', 'Heals 4 HP.', { heal: 4 }),
  item('cooked_trout', 'Cooked trout', '🍣', 'consumable', 'Heals 8 HP.', { heal: 8 }),
  item('cooked_lobster', 'Cooked lobster', '🦞', 'consumable', 'Heals 14 HP.', { heal: 14 }),
  item('vial', 'Vial', '🧫', 'refined'),
  item('attack_potion', 'Attack potion', '🧪', 'consumable', '+25% combat power for a fight.', {
    buff: { kind: 'power', value: 0.25 },
  }),
  item('restore_potion', 'Restore potion', '🧪', 'consumable', '+25% max HP for a fight.', {
    buff: { kind: 'maxHp', value: 0.25 },
  }),
  item('arrow', 'Arrow', '➰', 'refined'),
  item('air_rune', 'Air rune', '🌀', 'refined'),
  item('water_rune', 'Water rune', '💧', 'refined'),
  item('nature_rune', 'Nature rune', '🍃', 'refined'),
  item('uncut_gem', 'Uncut gem', '💎', 'raw'),
  item('cut_gem', 'Cut gem', '💎', 'refined'),
  // gems (§13.5.3.1): type = stat (ruby always crit), tier = ore. Rough → cut →
  // set into a band or crushed to dust for Enchanting.
  ...GEM_TYPES.flatMap((g) =>
    GEM_TIERS.flatMap((t) => [
      item(
        uncutGemId(g.id, t.tier),
        `Rough ${t.word.toLowerCase()} ${g.name.toLowerCase()}`,
        '🪨',
        'raw',
        `Cut it to a ${t.word.toLowerCase()} ${g.name.toLowerCase()}.`,
      ),
      item(
        gemId(g.id, t.tier),
        `${t.word} ${g.name}`,
        g.icon,
        'refined',
        `Grants ${g.label} when set.`,
      ),
    ]),
  ),
  ...GEM_TYPES.map((g) =>
    item(dustId(g.id), `${g.name} dust`, '✨', 'refined', `Enchants a piece with ${g.label}.`),
  ),
  // essences (§13.5.3.2): what Distill yields, and what every enchant is built from.
  ...ESSENCES.map((e) => item(essenceId(e.id), e.name, e.icon, 'refined', 'A distillation reagent.')),
  item('hide', 'Hide', '🟤', 'raw'),
  item('leather', 'Leather', '🟫', 'refined'),
  item('cloth', 'Cloth', '🧵', 'refined'),
  item('ash', 'Ash', '🌫️', 'refined'),
  item('plank', 'Plank', '🟧', 'refined'),
  item('bones', 'Bones', '🦴', 'raw'),
  item('grace', 'Grace', '🕊️', 'other'),
  item('coins', 'Coins', '🪙', 'coin'),
  // --- weapons (main hand) ---------------------------------------------------
  item('bronze_sword', 'Bronze sword', '🗡️', 'equipment', 'A melee weapon.', {
    slot: 'mainHand',
    tags: ['melee'],
    armourType: 'plate',
    combatStyle: 'melee',
    power: 3,
    stats: { strength: 1 },
    itemLevel: 1,
  }),
  item('iron_sword', 'Iron sword', '🗡️', 'equipment', 'A stronger melee weapon.', {
    slot: 'mainHand',
    tags: ['melee'],
    armourType: 'plate',
    combatStyle: 'melee',
    power: 6,
    stats: { strength: 2 },
    itemLevel: 2,
  }),
  item('mythril_sword', 'Mythril sword', '🗡️', 'equipment', 'A keen melee weapon.', {
    slot: 'mainHand',
    tags: ['melee'],
    armourType: 'plate',
    combatStyle: 'melee',
    power: 10,
    stats: { strength: 3 },
    itemLevel: 4,
  }),
  item('blessed_sword', 'Blessed sword', '🗡️', 'equipment', 'A mythril blade bound with runes.', {
    slot: 'mainHand',
    tags: ['melee'],
    armourType: 'plate',
    combatStyle: 'melee',
    power: 14,
    stats: { strength: 4, crit: 2 },
    itemLevel: 4,
  }),
  item('oak_shortbow', 'Oak shortbow', '🏹', 'equipment', 'A ranged weapon.', {
    slot: 'mainHand',
    tags: ['bow'],
    armourType: 'leather',
    combatStyle: 'ranged',
    power: 4,
    stats: { agility: 1 },
    itemLevel: 1,
  }),
  item('willow_longbow', 'Willow longbow', '🏹', 'equipment', 'A stronger bow.', {
    slot: 'mainHand',
    tags: ['bow'],
    armourType: 'leather',
    combatStyle: 'ranged',
    power: 8,
    stats: { agility: 2 },
    itemLevel: 2,
  }),
  item('yew_longbow', 'Yew longbow', '🏹', 'equipment', 'A marksman’s bow.', {
    slot: 'mainHand',
    tags: ['bow'],
    armourType: 'leather',
    combatStyle: 'ranged',
    power: 12,
    stats: { agility: 3, haste: 2 },
    itemLevel: 3,
  }),
  item('oak_staff', 'Oak staff', '🪄', 'equipment', 'A sorcerer’s staff.', {
    slot: 'mainHand',
    tags: ['staff'],
    armourType: 'cloth',
    combatStyle: 'magic',
    power: 5,
    stats: { intellect: 1 },
    itemLevel: 1,
  }),
  item('willow_staff', 'Willow staff', '🪄', 'equipment', 'A stronger staff.', {
    slot: 'mainHand',
    tags: ['staff'],
    armourType: 'cloth',
    combatStyle: 'magic',
    power: 9,
    stats: { intellect: 2, mastery: 2 },
    itemLevel: 2,
  }),

  // --- plate armour (Smithing) ----------------------------------------------
  gear(
    'bronze_helm',
    'Bronze helm',
    '⛑️',
    'head',
    'plate',
    'melee',
    { stamina: 1, strength: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'bronze_chest',
    'Bronze chestplate',
    '🛡️',
    'chest',
    'plate',
    'melee',
    { stamina: 2, strength: 2 },
    {
      armour: 2,
      itemLevel: 1,
    },
  ),
  gear(
    'bronze_waist',
    'Bronze belt',
    '🎗️',
    'waist',
    'plate',
    'melee',
    { stamina: 1, strength: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'bronze_legs',
    'Bronze leggings',
    '🦿',
    'legs',
    'plate',
    'melee',
    { stamina: 2, strength: 1 },
    {
      armour: 2,
      itemLevel: 1,
    },
  ),
  gear(
    'bronze_boots',
    'Bronze boots',
    '🥾',
    'feet',
    'plate',
    'melee',
    { stamina: 1, strength: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'bronze_gloves',
    'Bronze gauntlets',
    '🧤',
    'hands',
    'plate',
    'melee',
    { stamina: 1, strength: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'bronze_shield',
    'Bronze shield',
    '🛡️',
    'offHand',
    'plate',
    'melee',
    { stamina: 2, strength: 1 },
    {
      armour: 2,
      itemLevel: 1,
      tags: ['armour', 'plate', 'shield'],
    },
  ),
  gear(
    'iron_helm',
    'Iron helm',
    '⛑️',
    'head',
    'plate',
    'melee',
    { stamina: 2, strength: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'iron_chest',
    'Iron chestplate',
    '🛡️',
    'chest',
    'plate',
    'melee',
    { stamina: 3, strength: 3 },
    {
      armour: 3,
      itemLevel: 2,
    },
  ),
  gear(
    'iron_waist',
    'Iron belt',
    '🎗️',
    'waist',
    'plate',
    'melee',
    { stamina: 2, strength: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'iron_legs',
    'Iron leggings',
    '🦿',
    'legs',
    'plate',
    'melee',
    { stamina: 3, strength: 2 },
    {
      armour: 3,
      itemLevel: 2,
    },
  ),
  gear(
    'iron_boots',
    'Iron boots',
    '🥾',
    'feet',
    'plate',
    'melee',
    { stamina: 2, strength: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'iron_gloves',
    'Iron gauntlets',
    '🧤',
    'hands',
    'plate',
    'melee',
    { stamina: 2, strength: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'iron_shield',
    'Iron shield',
    '🛡️',
    'offHand',
    'plate',
    'melee',
    { stamina: 3, strength: 2 },
    {
      armour: 3,
      itemLevel: 2,
      tags: ['armour', 'plate', 'shield'],
    },
  ),
  gear(
    'steel_helm',
    'Steel helm',
    '⛑️',
    'head',
    'plate',
    'melee',
    { stamina: 3, strength: 3 },
    {
      armour: 3,
      itemLevel: 3,
    },
  ),
  gear(
    'steel_platebody',
    'Steel platebody',
    '🛡️',
    'chest',
    'plate',
    'melee',
    { stamina: 4, strength: 4 },
    {
      armour: 4,
      itemLevel: 3,
    },
  ),
  gear(
    'steel_waist',
    'Steel belt',
    '🎗️',
    'waist',
    'plate',
    'melee',
    { stamina: 3, strength: 3 },
    {
      armour: 3,
      itemLevel: 3,
    },
  ),
  gear(
    'steel_legs',
    'Steel leggings',
    '🦿',
    'legs',
    'plate',
    'melee',
    { stamina: 3, strength: 3 },
    {
      armour: 3,
      itemLevel: 3,
    },
  ),
  gear(
    'steel_boots',
    'Steel boots',
    '🥾',
    'feet',
    'plate',
    'melee',
    { stamina: 3, strength: 3 },
    {
      armour: 3,
      itemLevel: 3,
    },
  ),
  gear(
    'steel_gloves',
    'Steel gauntlets',
    '🧤',
    'hands',
    'plate',
    'melee',
    { stamina: 3, strength: 3 },
    {
      armour: 3,
      itemLevel: 3,
    },
  ),
  gear(
    'steel_shield',
    'Steel shield',
    '🛡️',
    'offHand',
    'plate',
    'melee',
    { stamina: 4, strength: 3 },
    {
      armour: 4,
      itemLevel: 3,
      tags: ['armour', 'plate', 'shield'],
    },
  ),
  gear(
    'mythril_helm',
    'Mythril helm',
    '⛑️',
    'head',
    'plate',
    'melee',
    { stamina: 4, strength: 4 },
    {
      armour: 4,
      itemLevel: 4,
    },
  ),
  gear(
    'mythril_chest',
    'Mythril chestplate',
    '🛡️',
    'chest',
    'plate',
    'melee',
    { stamina: 5, strength: 5 },
    {
      armour: 5,
      itemLevel: 4,
    },
  ),
  gear(
    'mythril_waist',
    'Mythril belt',
    '🎗️',
    'waist',
    'plate',
    'melee',
    { stamina: 4, strength: 4 },
    {
      armour: 4,
      itemLevel: 4,
    },
  ),
  gear(
    'mythril_legs',
    'Mythril leggings',
    '🦿',
    'legs',
    'plate',
    'melee',
    { stamina: 4, strength: 4 },
    {
      armour: 4,
      itemLevel: 4,
    },
  ),
  gear(
    'mythril_boots',
    'Mythril boots',
    '🥾',
    'feet',
    'plate',
    'melee',
    { stamina: 4, strength: 4 },
    {
      armour: 4,
      itemLevel: 4,
    },
  ),
  gear(
    'mythril_gloves',
    'Mythril gauntlets',
    '🧤',
    'hands',
    'plate',
    'melee',
    { stamina: 4, strength: 4 },
    {
      armour: 4,
      itemLevel: 4,
    },
  ),
  gear(
    'mythril_shield',
    'Mythril shield',
    '🛡️',
    'offHand',
    'plate',
    'melee',
    { stamina: 5, strength: 4 },
    {
      armour: 5,
      itemLevel: 4,
      tags: ['armour', 'plate', 'shield'],
    },
  ),
  gear(
    'adamant_helm',
    'Adamant helm',
    '⛑️',
    'head',
    'plate',
    'melee',
    { stamina: 5, strength: 5 },
    {
      armour: 5,
      itemLevel: 5,
    },
  ),
  gear(
    'adamant_platebody',
    'Adamant platebody',
    '🛡️',
    'chest',
    'plate',
    'melee',
    { stamina: 6, strength: 6 },
    {
      armour: 6,
      itemLevel: 5,
    },
  ),
  gear(
    'adamant_waist',
    'Adamant belt',
    '🎗️',
    'waist',
    'plate',
    'melee',
    { stamina: 5, strength: 5 },
    {
      armour: 5,
      itemLevel: 5,
    },
  ),
  gear(
    'adamant_legs',
    'Adamant leggings',
    '🦿',
    'legs',
    'plate',
    'melee',
    { stamina: 5, strength: 5 },
    {
      armour: 5,
      itemLevel: 5,
    },
  ),
  gear(
    'adamant_boots',
    'Adamant boots',
    '🥾',
    'feet',
    'plate',
    'melee',
    { stamina: 5, strength: 5 },
    {
      armour: 5,
      itemLevel: 5,
    },
  ),
  gear(
    'adamant_gloves',
    'Adamant gauntlets',
    '🧤',
    'hands',
    'plate',
    'melee',
    { stamina: 5, strength: 5 },
    {
      armour: 5,
      itemLevel: 5,
    },
  ),
  gear(
    'adamant_shield',
    'Adamant shield',
    '🛡️',
    'offHand',
    'plate',
    'melee',
    { stamina: 6, strength: 5 },
    {
      armour: 6,
      itemLevel: 5,
      tags: ['armour', 'plate', 'shield'],
    },
  ),

  // --- leather armour (Leatherworking) --------------------------------------
  gear(
    'leather_helm',
    'Leather hood',
    '🎩',
    'head',
    'leather',
    'ranged',
    { stamina: 1, agility: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'leather_body',
    'Leather body',
    '🥋',
    'chest',
    'leather',
    'ranged',
    { stamina: 2, agility: 2 },
    {
      armour: 2,
      itemLevel: 1,
    },
  ),
  gear(
    'leather_waist',
    'Leather belt',
    '🎗️',
    'waist',
    'leather',
    'ranged',
    { stamina: 1, agility: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'leather_legs',
    'Leather leggings',
    '🦿',
    'legs',
    'leather',
    'ranged',
    { stamina: 2, agility: 1 },
    {
      armour: 2,
      itemLevel: 1,
    },
  ),
  gear(
    'leather_boots',
    'Leather boots',
    '🥾',
    'feet',
    'leather',
    'ranged',
    { stamina: 1, agility: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'leather_gloves',
    'Leather gloves',
    '🧤',
    'hands',
    'leather',
    'ranged',
    { stamina: 1, agility: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'leather_quiver',
    'Leather quiver',
    '🎯',
    'offHand',
    'leather',
    'ranged',
    { stamina: 1, agility: 2 },
    {
      armour: 1,
      itemLevel: 1,
      tags: ['armour', 'leather', 'quiver'],
    },
  ),
  gear(
    'hardened_helm',
    'Hardened leather helm',
    '🎩',
    'head',
    'leather',
    'ranged',
    { stamina: 2, agility: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'hardened_chest',
    'Hardened leather chest',
    '🥋',
    'chest',
    'leather',
    'ranged',
    { stamina: 3, agility: 3 },
    {
      armour: 3,
      itemLevel: 2,
    },
  ),
  gear(
    'hardened_waist',
    'Hardened leather belt',
    '🎗️',
    'waist',
    'leather',
    'ranged',
    { stamina: 2, agility: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'hardened_legs',
    'Hardened leather leggings',
    '🦿',
    'legs',
    'leather',
    'ranged',
    { stamina: 3, agility: 2 },
    {
      armour: 3,
      itemLevel: 2,
    },
  ),
  gear(
    'hardened_boots',
    'Hardened leather boots',
    '🥾',
    'feet',
    'leather',
    'ranged',
    { stamina: 2, agility: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'hardened_gloves',
    'Hardened leather gloves',
    '🧤',
    'hands',
    'leather',
    'ranged',
    { stamina: 2, agility: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'hardened_quiver',
    'Hardened quiver',
    '🎯',
    'offHand',
    'leather',
    'ranged',
    { stamina: 2, agility: 3 },
    {
      armour: 2,
      itemLevel: 2,
      tags: ['armour', 'leather', 'quiver'],
    },
  ),

  // --- cloth armour (Tailoring) ---------------------------------------------
  gear(
    'cloth_hood',
    'Cloth hood',
    '🧢',
    'head',
    'cloth',
    'magic',
    { stamina: 1, intellect: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'cloth_robe',
    'Cloth robe',
    '🥋',
    'chest',
    'cloth',
    'magic',
    { stamina: 2, intellect: 2 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'cloth_sash',
    'Cloth sash',
    '🎗️',
    'waist',
    'cloth',
    'magic',
    { stamina: 1, intellect: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'cloth_legs',
    'Cloth leggings',
    '🦿',
    'legs',
    'cloth',
    'magic',
    { stamina: 2, intellect: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'cloth_boots',
    'Cloth boots',
    '🥾',
    'feet',
    'cloth',
    'magic',
    { stamina: 1, intellect: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'cloth_gloves',
    'Cloth gloves',
    '🧤',
    'hands',
    'cloth',
    'magic',
    { stamina: 1, intellect: 1 },
    {
      armour: 1,
      itemLevel: 1,
    },
  ),
  gear(
    'cloth_tome',
    'Cloth tome',
    '📖',
    'offHand',
    'cloth',
    'magic',
    { stamina: 1, intellect: 2 },
    {
      armour: 1,
      itemLevel: 1,
      tags: ['armour', 'cloth', 'tome'],
    },
  ),
  gear(
    'silk_hood',
    'Silk hood',
    '🧢',
    'head',
    'cloth',
    'magic',
    { stamina: 2, intellect: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'silk_robe',
    'Silk robe',
    '🥋',
    'chest',
    'cloth',
    'magic',
    { stamina: 3, intellect: 3 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'silk_sash',
    'Silk sash',
    '🎗️',
    'waist',
    'cloth',
    'magic',
    { stamina: 2, intellect: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'silk_legs',
    'Silk leggings',
    '🦿',
    'legs',
    'cloth',
    'magic',
    { stamina: 3, intellect: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'silk_boots',
    'Silk boots',
    '🥾',
    'feet',
    'cloth',
    'magic',
    { stamina: 2, intellect: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'silk_gloves',
    'Silk gloves',
    '🧤',
    'hands',
    'cloth',
    'magic',
    { stamina: 2, intellect: 2 },
    {
      armour: 2,
      itemLevel: 2,
    },
  ),
  gear(
    'silk_tome',
    'Silk tome',
    '📖',
    'offHand',
    'cloth',
    'magic',
    { stamina: 2, intellect: 3 },
    {
      armour: 2,
      itemLevel: 2,
      tags: ['armour', 'cloth', 'tome'],
    },
  ),
  gear(
    'mystic_robe',
    'Mystic robe',
    '🥋',
    'chest',
    'cloth',
    'magic',
    { stamina: 3, intellect: 3, mastery: 2 },
    {
      armour: 3,
      itemLevel: 3,
    },
  ),

  // --- jewellery (Crafting + Enchanting) ------------------------------------
  // A ring is a metal band + a gem; the gem's type sets the stat (§13.5.3.1).
  ...GEM_TYPES.flatMap((g) =>
    GEM_TIERS.map((t) =>
      item(
        `ring_${g.id}${t.tier}`,
        `${t.word} ${g.name} ring`,
        '💍',
        'equipment',
        `A ${g.name.toLowerCase()} in a ${t.metalBand.replace('_band', '')} band.`,
        {
          slot: 'ring1',
          tags: ['jewelry'],
          armourType: 'jewelry',
          combatStyle: 'general',
          stats: gemRingStats(g, t),
          itemLevel: t.tier,
        },
      ),
    ),
  ),
  item('sapphire_amulet', 'Sapphire amulet', '🔷', 'equipment', 'A cut gem on a chain.', {
    slot: 'neck',
    tags: ['jewelry'],
    armourType: 'jewelry',
    combatStyle: 'general',
    stats: { stamina: 1, crit: 1 },
    power: 2,
    itemLevel: 1,
  }),
  item('enchanted_amulet', 'Amulet of power', '🔮', 'equipment', 'A rune-bound amulet.', {
    slot: 'neck',
    tags: ['jewelry'],
    armourType: 'jewelry',
    combatStyle: 'general',
    stats: { stamina: 2, mastery: 2, crit: 1 },
    power: 5,
    itemLevel: 2,
  }),
  item('lucky_charm', 'Lucky charm', '🍀', 'equipment', 'A trinket for fortunate drops.', {
    slot: 'trinket1',
    tags: ['jewelry'],
    armourType: 'jewelry',
    combatStyle: 'general',
    stats: { crit: 2, haste: 1 },
    itemLevel: 2,
  }),
  item('rune_trinket', 'Rune trinket', '🧿', 'equipment', 'A trinket humming with runes.', {
    slot: 'trinket2',
    tags: ['jewelry'],
    armourType: 'jewelry',
    combatStyle: 'general',
    stats: { mastery: 2, stamina: 2 },
    itemLevel: 3,
  }),
  item('rune_orb', 'Rune orb', '🔮', 'equipment', 'An off-hand focus for magic.', {
    slot: 'offHand',
    tags: ['jewelry', 'orb'],
    armourType: 'jewelry',
    combatStyle: 'magic',
    stats: { intellect: 2, haste: 1 },
    power: 3,
    itemLevel: 2,
  }),
  item(
    'super_attack_potion',
    'Super attack potion',
    '🧪',
    'consumable',
    '+40% combat power for a fight.',
    {
      buff: { kind: 'power', value: 0.4 },
    },
  ),
]

// --- actions -----------------------------------------------------------------

const A = (a: ActionDef): ActionDef => a

/** Reward per unit by material tier — a deeper band pays a little more per unit. */
const BAND_XP_PER_UNIT: Record<number, number> = { 1: 1, 2: 1.1, 3: 1.2, 4: 1.3, 5: 1.4 }

/** The band levels a gear slot unlocks at, cheapest material first. */
const SLOT_LEVELS = [3, 5, 6, 8, 10, 14, 18, 24]

/**
 * The XP a band recipe pays: its material cost scaled by the band's tier and by how
 * deep the slot unlocks, so the reward grows ~10% per material over the previous
 * slot and the deepest piece you can afford is always the most rewarding (§13.5.3).
 */
function craftXp(count: number, tier: number, bandLevel: number): number {
  const slot = Math.max(0, SLOT_LEVELS.indexOf(bandLevel))
  return Math.max(1, Math.round(count * (BAND_XP_PER_UNIT[tier] ?? 1) * (1 + 0.1 * slot)))
}

/**
 * A gear recipe for one **band** of a line (§13.5.3). It belongs to a material band,
 * unlocks at `bandLevel` inside it, and consumes that line's material. Smithing,
 * Leatherworking and Tailoring share it — only the skill, verb and material differ.
 */
function bandGear(
  skillId: 'smithing' | 'leatherworking' | 'tailoring',
  verb: string,
  material: string,
  id: string,
  bandId: BandId,
  itemId: string,
  count: number,
  bandLevel: number,
  deckLevel = 'zhfreq',
): ActionDef {
  const band = BAND_BY_ID.get(bandId)!
  return A({
    id,
    skillId,
    name: `${verb} ${itemId.replaceAll('_', ' ')}`,
    description: `Needs ${band.name} ${bandLevel}.`,
    tier: band.tier,
    xp: craftXp(count, band.tier, bandLevel),
    deckLevel,
    band: bandId,
    bandLevel,
    consumes: [{ item: material, count }],
    produces: [{ item: itemId, count: 1 }],
  })
}

const forgePlate = (
  id: string,
  bandId: BandId,
  itemId: string,
  count: number,
  bandLevel: number,
  deckLevel = 'zhfreq',
): ActionDef =>
  bandGear('smithing', 'Forge', `${bandId}_bar`, id, bandId, itemId, count, bandLevel, deckLevel)

const sewLeather = (
  id: string,
  bandId: BandId,
  itemId: string,
  count: number,
  bandLevel: number,
  deckLevel = 'zhfreq',
): ActionDef =>
  bandGear('leatherworking', 'Sew', 'leather', id, bandId, itemId, count, bandLevel, deckLevel)

const sewCloth = (
  id: string,
  bandId: BandId,
  itemId: string,
  count: number,
  bandLevel: number,
  deckLevel = 'zhfreq',
): ActionDef =>
  bandGear('tailoring', 'Sew', 'cloth', id, bandId, itemId, count, bandLevel, deckLevel)

export const ACTIONS: ActionDef[] = [
  // Mining
  A({
    id: 'mine-copper',
    skillId: 'mining',
    name: 'Mine copper',
    description: 'Common ore.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'copper_ore', count: 1 }],
  }),
  A({
    id: 'mine-tin',
    skillId: 'mining',
    name: 'Mine tin',
    description: 'Common ore. Smelt with copper.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'tin_ore', count: 1 }],
  }),
  A({
    id: 'mine-essence',
    skillId: 'mining',
    name: 'Mine rune essence',
    description: 'For Runecrafting.',
    tier: 1,
    xp: 6,
    deckLevel: 'jafreq',
    produces: [{ item: 'rune_essence', count: 1 }],
  }),
  A({
    id: 'mine-iron',
    skillId: 'mining',
    name: 'Mine iron',
    description: 'Needs Mining 5.',
    tier: 2,
    xp: 12,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'mining', level: 5 }],
    produces: [{ item: 'iron_ore', count: 1 }],
  }),
  A({
    id: 'mine-coal',
    skillId: 'mining',
    name: 'Mine coal',
    description: 'Needs Mining 15.',
    tier: 3,
    xp: 16,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'mining', level: 15 }],
    produces: [{ item: 'coal', count: 1 }],
  }),

  // Woodcutting
  A({
    id: 'chop-oak',
    skillId: 'woodcutting',
    name: 'Chop oak',
    description: 'Basic logs.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'oak_log', count: 1 }],
  }),
  A({
    id: 'chop-willow',
    skillId: 'woodcutting',
    name: 'Chop willow',
    description: 'Needs Woodcutting 5.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    requires: [{ skill: 'woodcutting', level: 5 }],
    produces: [{ item: 'willow_log', count: 1 }],
  }),
  A({
    id: 'chop-maple',
    skillId: 'woodcutting',
    name: 'Chop maple',
    description: 'Needs Woodcutting 15.',
    tier: 3,
    xp: 16,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'woodcutting', level: 15 }],
    produces: [{ item: 'maple_log', count: 1 }],
  }),

  // Fishing
  A({
    id: 'fish-shrimp',
    skillId: 'fishing',
    name: 'Catch shrimp',
    description: 'Basic fish.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'raw_shrimp', count: 1 }],
  }),
  A({
    id: 'fish-trout',
    skillId: 'fishing',
    name: 'Catch trout',
    description: 'Needs Fishing 5.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    requires: [{ skill: 'fishing', level: 5 }],
    produces: [{ item: 'raw_trout', count: 1 }],
  }),
  A({
    id: 'fish-lobster',
    skillId: 'fishing',
    name: 'Catch lobster',
    description: 'Needs Fishing 15.',
    tier: 3,
    xp: 16,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'fishing', level: 15 }],
    produces: [{ item: 'raw_lobster', count: 1 }],
  }),

  // Farming
  A({
    id: 'farm-guam',
    skillId: 'farming',
    name: 'Harvest guam',
    description: 'A basic herb.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'guam', count: 1 }],
  }),
  A({
    id: 'farm-tarromin',
    skillId: 'farming',
    name: 'Harvest tarromin',
    description: 'Needs Farming 5.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    requires: [{ skill: 'farming', level: 5 }],
    produces: [{ item: 'tarromin', count: 1 }],
  }),
  A({
    id: 'farm-harralander',
    skillId: 'farming',
    name: 'Harvest harralander',
    description: 'Needs Farming 15.',
    tier: 3,
    xp: 16,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'farming', level: 15 }],
    produces: [{ item: 'harralander', count: 1 }],
  }),
  A({
    id: 'farm-wool',
    skillId: 'farming',
    name: 'Shear wool',
    description: 'Wool for Tailoring.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'wool', count: 1 }],
  }),
  A({
    id: 'farm-silk',
    skillId: 'farming',
    name: 'Harvest silk',
    description: 'Needs Farming 20.',
    tier: 3,
    xp: 18,
    deckLevel: 'jafreq',
    requires: [{ skill: 'farming', level: 20 }],
    produces: [{ item: 'silk', count: 1 }],
  }),

  // Smithing — one **band** per material (§13.5.3): every item of a metal feeds the
  // same score, unlocks at a threshold inside it, and the next metal opens at band 40.
  A({
    id: 'smelt-bronze',
    skillId: 'smithing',
    name: 'Smelt bronze bar',
    description: 'Copper + tin.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    band: 'bronze',
    bandLevel: 1,
    consumes: [
      { item: 'copper_ore', count: 2 },
      { item: 'tin_ore', count: 2 },
    ],
    produces: [{ item: 'bronze_bar', count: 1 }],
  }),
  A({
    id: 'smelt-iron',
    skillId: 'smithing',
    name: 'Smelt iron bar',
    description: 'Needs Bronze 40.',
    tier: 2,
    xp: 14,
    deckLevel: 'zhfreq',
    band: 'iron',
    bandLevel: 1,
    consumes: [{ item: 'iron_ore', count: 2 }],
    produces: [{ item: 'iron_bar', count: 1 }],
  }),
  A({
    id: 'smelt-steel',
    skillId: 'smithing',
    name: 'Smelt steel bar',
    description: 'Needs Iron 40.',
    tier: 3,
    xp: 20,
    deckLevel: 'jafreq',
    band: 'steel',
    bandLevel: 1,
    consumes: [
      { item: 'iron_ore', count: 2 },
      { item: 'coal', count: 2 },
    ],
    produces: [{ item: 'steel_bar', count: 1 }],
  }),
  A({
    id: 'forge-bronze-sword',
    skillId: 'smithing',
    name: 'Forge bronze sword',
    description: 'A starter weapon.',
    tier: 1,
    xp: 12,
    deckLevel: 'zhfreq',
    band: 'bronze',
    bandLevel: 3,
    consumes: [{ item: 'bronze_bar', count: 12 }],
    produces: [{ item: 'bronze_sword', count: 1 }],
  }),
  A({
    id: 'forge-iron-sword',
    skillId: 'smithing',
    name: 'Forge iron sword',
    description: 'Needs Iron 3.',
    tier: 2,
    xp: 22,
    deckLevel: 'zhfreq',
    band: 'iron',
    bandLevel: 3,
    consumes: [{ item: 'iron_bar', count: 20 }],
    produces: [{ item: 'iron_sword', count: 1 }],
  }),
  A({
    id: 'forge-steel-plate',
    skillId: 'smithing',
    name: 'Forge steel platebody',
    description: 'Needs Steel 24.',
    tier: 3,
    xp: 82,
    deckLevel: 'jafreq',
    band: 'steel',
    bandLevel: 24,
    consumes: [{ item: 'steel_bar', count: 40 }],
    produces: [{ item: 'steel_platebody', count: 1 }],
  }),
  // The rest of the plate set: every slot is craftable, and the higher tiers
  // simply cost more bars. The gear gets random secondary stats on every craft.
  forgePlate('forge-bronze-helm', 'bronze', 'bronze_helm', 4, 10),
  forgePlate('forge-bronze-chest', 'bronze', 'bronze_chest', 8, 24),
  forgePlate('forge-bronze-waist', 'bronze', 'bronze_waist', 3, 6),
  forgePlate('forge-bronze-legs', 'bronze', 'bronze_legs', 6, 18),
  forgePlate('forge-bronze-boots', 'bronze', 'bronze_boots', 4, 8),
  forgePlate('forge-bronze-gloves', 'bronze', 'bronze_gloves', 3, 5),
  forgePlate('forge-bronze-shield', 'bronze', 'bronze_shield', 5, 14),
  forgePlate('forge-iron-helm', 'iron', 'iron_helm', 6, 10),
  forgePlate('forge-iron-chest', 'iron', 'iron_chest', 12, 24),
  forgePlate('forge-iron-waist', 'iron', 'iron_waist', 4, 6),
  forgePlate('forge-iron-legs', 'iron', 'iron_legs', 8, 18),
  forgePlate('forge-iron-boots', 'iron', 'iron_boots', 6, 8),
  forgePlate('forge-iron-gloves', 'iron', 'iron_gloves', 4, 5),
  forgePlate('forge-iron-shield', 'iron', 'iron_shield', 8, 14),
  forgePlate('forge-steel-helm', 'steel', 'steel_helm', 10, 10),
  forgePlate('forge-steel-waist', 'steel', 'steel_waist', 8, 6),
  forgePlate('forge-steel-boots', 'steel', 'steel_boots', 10, 8),
  forgePlate('forge-steel-gloves', 'steel', 'steel_gloves', 8, 5),
  forgePlate('forge-steel-shield', 'steel', 'steel_shield', 12, 14),
  forgePlate('forge-mythril-helm', 'mythril', 'mythril_helm', 12, 10),
  forgePlate('forge-mythril-chest', 'mythril', 'mythril_chest', 20, 24),
  forgePlate('forge-mythril-waist', 'mythril', 'mythril_waist', 10, 6),
  forgePlate('forge-mythril-boots', 'mythril', 'mythril_boots', 12, 8),
  forgePlate('forge-mythril-gloves', 'mythril', 'mythril_gloves', 10, 5),
  forgePlate('forge-mythril-shield', 'mythril', 'mythril_shield', 16, 14),
  forgePlate('forge-adamant-helm', 'adamant', 'adamant_helm', 16, 10),
  forgePlate('forge-adamant-waist', 'adamant', 'adamant_waist', 12, 6),
  forgePlate('forge-adamant-legs', 'adamant', 'adamant_legs', 22, 18),
  forgePlate('forge-adamant-boots', 'adamant', 'adamant_boots', 16, 8),
  forgePlate('forge-adamant-gloves', 'adamant', 'adamant_gloves', 12, 5),
  forgePlate('forge-adamant-shield', 'adamant', 'adamant_shield', 20, 14),
  // Ring bases — the metal half of a ring; Jewellery sets the gem (§13.5.3.1).
  forgePlate('forge-bronze-band', 'bronze', 'bronze_band', 2, 3),
  forgePlate('forge-iron-band', 'iron', 'iron_band', 2, 3),
  forgePlate('forge-mythril-band', 'mythril', 'mythril_band', 2, 3),

  // Cooking
  A({
    id: 'cook-shrimp',
    skillId: 'cooking',
    name: 'Cook shrimp',
    description: 'Basic food.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    consumes: [{ item: 'raw_shrimp', count: 1 }],
    produces: [{ item: 'cooked_shrimp', count: 1 }],
  }),
  A({
    id: 'cook-trout',
    skillId: 'cooking',
    name: 'Cook trout',
    description: 'Needs Cooking 5.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    requires: [{ skill: 'cooking', level: 5 }],
    consumes: [{ item: 'raw_trout', count: 1 }],
    produces: [{ item: 'cooked_trout', count: 1 }],
  }),
  A({
    id: 'cook-lobster',
    skillId: 'cooking',
    name: 'Cook lobster',
    description: 'Needs Cooking 15.',
    tier: 3,
    xp: 16,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'cooking', level: 15 }],
    consumes: [{ item: 'raw_lobster', count: 1 }],
    produces: [{ item: 'cooked_lobster', count: 1 }],
  }),

  // Herblore
  A({
    id: 'brew-attack',
    skillId: 'herblore',
    name: 'Brew attack potion',
    description: 'Guam + vial.',
    tier: 1,
    xp: 12,
    deckLevel: 'zhfreq',
    consumes: [
      { item: 'guam', count: 2 },
      { item: 'vial', count: 2 },
    ],
    produces: [{ item: 'attack_potion', count: 1 }],
  }),
  A({
    id: 'brew-restore',
    skillId: 'herblore',
    name: 'Brew restore potion',
    description: 'Needs Herblore 10.',
    tier: 2,
    xp: 16,
    deckLevel: 'jafreq',
    requires: [{ skill: 'herblore', level: 10 }],
    consumes: [
      { item: 'tarromin', count: 2 },
      { item: 'vial', count: 2 },
    ],
    produces: [{ item: 'restore_potion', count: 1 }],
  }),

  // Fletching — the wood line: oak → willow → yew (§13.5.3).
  A({
    id: 'fletch-oak-bow',
    skillId: 'fletching',
    name: 'Fletch oak shortbow',
    description: 'A starter bow.',
    tier: 1,
    xp: 12,
    deckLevel: 'zhfreq',
    band: 'oak',
    bandLevel: 3,
    consumes: [{ item: 'oak_log', count: 12 }],
    produces: [{ item: 'oak_shortbow', count: 1 }],
  }),
  A({
    id: 'fletch-arrows',
    skillId: 'fletching',
    name: 'Fletch arrows',
    description: '15 arrows per log.',
    tier: 1,
    xp: 10,
    deckLevel: 'jafreq',
    band: 'oak',
    bandLevel: 1,
    consumes: [{ item: 'oak_log', count: 1 }],
    produces: [{ item: 'arrow', count: 15 }],
  }),
  A({
    id: 'fletch-willow-bow',
    skillId: 'fletching',
    name: 'Fletch willow longbow',
    description: 'Needs Willow 3.',
    tier: 2,
    xp: 26,
    deckLevel: 'zhfreq',
    band: 'willow',
    bandLevel: 3,
    consumes: [{ item: 'willow_log', count: 24 }],
    produces: [{ item: 'willow_longbow', count: 1 }],
  }),
  A({
    id: 'fletch-staff',
    skillId: 'fletching',
    name: 'Carve an oak staff',
    description: 'A weapon for Magic.',
    tier: 1,
    xp: 12,
    deckLevel: 'jafreq',
    band: 'oak',
    bandLevel: 3,
    consumes: [{ item: 'oak_log', count: 12 }],
    produces: [{ item: 'oak_staff', count: 1 }],
  }),
  A({
    id: 'fletch-willow-staff',
    skillId: 'fletching',
    name: 'Carve a willow staff',
    description: 'Needs Willow 3.',
    tier: 2,
    xp: 22,
    deckLevel: 'zhfreq',
    band: 'willow',
    bandLevel: 3,
    consumes: [{ item: 'willow_log', count: 20 }],
    produces: [{ item: 'willow_staff', count: 1 }],
  }),

  // Runecrafting
  A({
    id: 'rc-air',
    skillId: 'runecrafting',
    name: 'Craft air rune',
    description: 'From essence.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    consumes: [{ item: 'rune_essence', count: 2 }],
    produces: [{ item: 'air_rune', count: 1 }],
  }),
  A({
    id: 'rc-water',
    skillId: 'runecrafting',
    name: 'Craft water rune',
    description: 'Needs Runecrafting 5.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    requires: [{ skill: 'runecrafting', level: 5 }],
    consumes: [{ item: 'rune_essence', count: 2 }],
    produces: [{ item: 'water_rune', count: 1 }],
  }),
  A({
    id: 'rc-nature',
    skillId: 'runecrafting',
    name: 'Craft nature rune',
    description: 'Needs Runecrafting 20.',
    tier: 3,
    xp: 20,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'runecrafting', level: 20 }],
    consumes: [{ item: 'rune_essence', count: 3 }],
    produces: [{ item: 'nature_rune', count: 1 }],
  }),

  // Crafting
  A({
    id: 'craft-vial',
    skillId: 'crafting',
    name: 'Blow a vial',
    description: 'For Herblore.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'vial', count: 1 }],
  }),
  A({
    id: 'craft-gem',
    skillId: 'crafting',
    name: 'Cut a gem',
    description: 'Uncut → cut.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    consumes: [{ item: 'uncut_gem', count: 2 }],
    produces: [{ item: 'cut_gem', count: 1 }],
  }),
  // Prospecting (§13.5.3.1): **one** action, whatever the ore. You choose which ore
  // to crush; the ore's tier decides the gem table (any type of that tier can fall).
  // It always spends the ore and only sometimes finds a gem, so this one action
  // levels no matter which ore you pick.
  A({
    id: 'prospect',
    skillId: 'crafting',
    name: 'Prospect ore',
    description: 'Crush an ore you hold — may find nothing.',
    tier: 1,
    xp: 12,
    deckLevel: 'zhfreq',
    choices: [
      ...GEM_TIERS.map((t) => ({
        id: t.ore.replace('_ore', ''),
        label: t.ore.replace('_', ' ').replace(/^./, (c) => c.toUpperCase()),
        successChance: 0.35 + 0.05 * t.tier,
        successPerLevel: 0.03,
        consumes: [{ item: t.ore, count: 5 }],
        table: GEM_TYPES.map((g) => ({ item: uncutGemId(g.id, t.tier), weight: 1 })),
      })),
      {
        id: 'adamant',
        label: 'Adamant ore',
        successChance: 0.55,
        successPerLevel: 0.03,
        consumes: [{ item: 'adamant_ore', count: 5 }],
        table: GEM_TYPES.map((g) => ({ item: uncutGemId(g.id, 3), weight: 2 })),
      },
    ],
  }),
  // Cutting (§13.5.3.1): **one action per tier**, whatever the gem. Pick a rough gem
  // of the tier and cut it — every gem of a tier shares the one action, and its level.
  ...GEM_TIERS.map((t) =>
    A({
      id: `cut-gems-${t.band}`,
      skillId: 'crafting',
      name: `Cut ${t.word.toLowerCase()} gems`,
      description: `Cut any rough ${t.word.toLowerCase()} gem.`,
      tier: t.tier,
      xp: 10 + 4 * t.tier,
      deckLevel: 'zhfreq',
      band: t.band,
      bandLevel: 3,
      choices: GEM_TYPES.map((g) => ({
        id: g.id,
        label: `Rough ${g.name.toLowerCase()}`,
        consumes: [{ item: uncutGemId(g.id, t.tier), count: 1 }],
        produces: [{ item: gemId(g.id, t.tier), count: 1 }],
      })),
    }),
  ),
  A({
    id: 'craft-leather',
    skillId: 'crafting',
    name: 'Tan leather',
    description: 'Hide → leather.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    consumes: [{ item: 'hide', count: 2 }],
    produces: [{ item: 'leather', count: 1 }],
  }),
  A({
    id: 'craft-leather-body',
    skillId: 'crafting',
    name: 'Make leather body',
    description: 'Light armour.',
    tier: 2,
    xp: 14,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'crafting', level: 5 }],
    consumes: [{ item: 'leather', count: 14 }],
    produces: [{ item: 'leather_body', count: 1 }],
  }),

  // Leatherworking: hides → leather → the ranged armour set.
  A({
    id: 'tan-hide',
    skillId: 'leatherworking',
    name: 'Tan a hide',
    description: 'Hide → leather.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    band: 'leather',
    bandLevel: 1,
    consumes: [{ item: 'hide', count: 2 }],
    produces: [{ item: 'leather', count: 1 }],
  }),
  sewLeather('sew-leather-helm', 'leather', 'leather_helm', 4, 10),
  sewLeather('sew-leather-body', 'leather', 'leather_body', 8, 24),
  sewLeather('sew-leather-waist', 'leather', 'leather_waist', 3, 6),
  sewLeather('sew-leather-legs', 'leather', 'leather_legs', 6, 18),
  sewLeather('sew-leather-boots', 'leather', 'leather_boots', 4, 8),
  sewLeather('sew-leather-gloves', 'leather', 'leather_gloves', 3, 5),
  sewLeather('sew-leather-quiver', 'leather', 'leather_quiver', 5, 14),
  sewLeather('sew-hardened-helm', 'hardened', 'hardened_helm', 8, 10),
  sewLeather('sew-hardened-chest', 'hardened', 'hardened_chest', 14, 24),
  sewLeather('sew-hardened-waist', 'hardened', 'hardened_waist', 6, 6),
  sewLeather('sew-hardened-legs', 'hardened', 'hardened_legs', 10, 18),
  sewLeather('sew-hardened-boots', 'hardened', 'hardened_boots', 8, 8),
  sewLeather('sew-hardened-gloves', 'hardened', 'hardened_gloves', 6, 5),
  sewLeather('sew-hardened-quiver', 'hardened', 'hardened_quiver', 9, 14),

  // Tailoring: wool → cloth → the magic armour set.
  A({
    id: 'weave-cloth',
    skillId: 'tailoring',
    name: 'Weave cloth',
    description: 'Wool → cloth.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    band: 'cloth',
    bandLevel: 1,
    consumes: [{ item: 'wool', count: 2 }],
    produces: [{ item: 'cloth', count: 1 }],
  }),
  sewCloth('sew-cloth-hood', 'cloth', 'cloth_hood', 4, 10),
  sewCloth('sew-cloth-robe', 'cloth', 'cloth_robe', 8, 24),
  sewCloth('sew-cloth-sash', 'cloth', 'cloth_sash', 3, 6),
  sewCloth('sew-cloth-legs', 'cloth', 'cloth_legs', 6, 18),
  sewCloth('sew-cloth-boots', 'cloth', 'cloth_boots', 4, 8),
  sewCloth('sew-cloth-gloves', 'cloth', 'cloth_gloves', 3, 5),
  sewCloth('sew-cloth-tome', 'cloth', 'cloth_tome', 5, 14),
  sewCloth('sew-silk-hood', 'silk', 'silk_hood', 8, 10),
  sewCloth('sew-silk-robe', 'silk', 'silk_robe', 14, 24),
  sewCloth('sew-silk-sash', 'silk', 'silk_sash', 6, 6),
  sewCloth('sew-silk-legs', 'silk', 'silk_legs', 10, 18),
  sewCloth('sew-silk-boots', 'silk', 'silk_boots', 8, 8),
  sewCloth('sew-silk-gloves', 'silk', 'silk_gloves', 6, 5),
  sewCloth('sew-silk-tome', 'silk', 'silk_tome', 9, 14),

  // Firemaking
  A({
    id: 'burn-oak',
    skillId: 'firemaking',
    name: 'Burn oak',
    description: 'Oak → ash.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    consumes: [{ item: 'oak_log', count: 2 }],
    produces: [{ item: 'ash', count: 1 }],
  }),
  A({
    id: 'burn-willow',
    skillId: 'firemaking',
    name: 'Burn willow',
    description: 'Needs Firemaking 10.',
    tier: 2,
    xp: 12,
    deckLevel: 'jafreq',
    requires: [{ skill: 'firemaking', level: 10 }],
    consumes: [{ item: 'willow_log', count: 2 }],
    produces: [{ item: 'ash', count: 1 }],
  }),

  // Construction
  A({
    id: 'make-plank',
    skillId: 'construction',
    name: 'Saw a plank',
    description: 'Log → plank.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    consumes: [{ item: 'oak_log', count: 2 }],
    produces: [{ item: 'plank', count: 1 }],
  }),
  A({
    id: 'build-chair',
    skillId: 'construction',
    name: 'Build a chair',
    description: 'Needs Construction 5.',
    tier: 2,
    xp: 14,
    deckLevel: 'jafreq',
    requires: [{ skill: 'construction', level: 5 }],
    consumes: [{ item: 'plank', count: 2 }],
    produces: [{ item: 'plank', count: 1 }],
  }),

  // Thieving
  A({
    id: 'steal-coins',
    skillId: 'thieving',
    name: 'Pickpocket',
    description: 'A handful of coins.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    produces: [{ item: 'coins', count: 10 }],
  }),
  A({
    id: 'steal-gem',
    skillId: 'thieving',
    name: 'Steal a gem',
    description: 'Needs Thieving 10.',
    tier: 2,
    xp: 16,
    deckLevel: 'jafreq',
    requires: [{ skill: 'thieving', level: 10 }],
    produces: [{ item: 'uncut_gem', count: 1 }],
  }),

  // Agility
  A({
    id: 'agility-drill',
    skillId: 'agility',
    name: 'Speed drill',
    description: 'Trains every profession a little.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    produces: [{ item: 'grace', count: 1 }],
  }),

  // Combat (gear-gated)
  A({
    id: 'train-attack',
    skillId: 'attack',
    name: 'Spar (melee)',
    description: 'Requires a melee weapon.',
    tier: 1,
    xp: 14,
    deckLevel: 'zhfreq',
    equip: { slot: 'mainHand', tag: 'melee' },
    produces: [{ item: 'bones', count: 1 }],
  }),
  A({
    id: 'train-strength',
    skillId: 'strength',
    name: 'Power training',
    description: 'Requires a melee weapon.',
    tier: 1,
    xp: 14,
    deckLevel: 'zhfreq',
    equip: { slot: 'mainHand', tag: 'melee' },
    produces: [{ item: 'bones', count: 1 }],
  }),
  A({
    id: 'train-defence',
    skillId: 'defence',
    name: 'Train defence',
    description: 'Requires body armour.',
    tier: 1,
    xp: 14,
    deckLevel: 'zhfreq',
    equip: { slot: 'chest', tag: 'armour' },
    produces: [{ item: 'hide', count: 1 }],
  }),
  A({
    id: 'train-constitution',
    skillId: 'constitution',
    name: 'Endurance',
    description: 'Requires body armour.',
    tier: 1,
    xp: 12,
    deckLevel: 'jafreq',
    equip: { slot: 'chest', tag: 'armour' },
    produces: [{ item: 'bones', count: 1 }],
  }),
  A({
    id: 'train-ranged',
    skillId: 'ranged',
    name: 'Ranged practice',
    description: 'Requires a bow; uses 3 arrows.',
    tier: 1,
    xp: 16,
    deckLevel: 'zhfreq',
    equip: { slot: 'mainHand', tag: 'bow' },
    consumes: [{ item: 'arrow', count: 5 }],
    produces: [{ item: 'hide', count: 1 }],
  }),
  A({
    id: 'train-magic',
    skillId: 'magic',
    name: 'Cast',
    description: 'Uses 2 air runes.',
    tier: 1,
    xp: 18,
    deckLevel: 'jafreq',
    consumes: [{ item: 'air_rune', count: 4 }],
    produces: [{ item: 'uncut_gem', count: 1 }],
  }),
  A({
    id: 'bury-bones',
    skillId: 'prayer',
    name: 'Bury bones',
    description: 'Bones → grace.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
    consumes: [{ item: 'bones', count: 2 }],
    produces: [{ item: 'grace', count: 1 }],
  }),
  A({
    id: 'slay',
    skillId: 'slayer',
    name: 'Hunt',
    description: 'Requires a melee weapon.',
    tier: 2,
    xp: 20,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'attack', level: 10 }],
    equip: { slot: 'mainHand', tag: 'melee' },
    produces: [
      { item: 'guam', count: 1 },
      { item: 'bones', count: 1 },
    ],
  }),

  // --- tier 4–5: deeper chains, and recipes gated on a second profession ---------
  A({
    id: 'mine-mythril',
    skillId: 'mining',
    name: 'Mine mythril',
    description: 'Needs Mining 25.',
    tier: 4,
    xp: 22,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'mining', level: 25 }],
    produces: [{ item: 'mythril_ore', count: 1 }],
  }),
  A({
    id: 'mine-adamant',
    skillId: 'mining',
    name: 'Mine adamant',
    description: 'Needs Mining 40.',
    tier: 5,
    xp: 30,
    deckLevel: 'jafreq',
    requires: [{ skill: 'mining', level: 40 }],
    produces: [{ item: 'adamant_ore', count: 1 }],
  }),
  A({
    id: 'smelt-mythril',
    skillId: 'smithing',
    name: 'Smelt mythril bar',
    description: 'Needs Steel 40 and Mining 20.',
    tier: 4,
    xp: 26,
    deckLevel: 'jafreq',
    band: 'mythril',
    bandLevel: 1,
    requires: [{ skill: 'mining', level: 20 }],
    consumes: [
      { item: 'mythril_ore', count: 2 },
      { item: 'coal', count: 3 },
    ],
    produces: [{ item: 'mythril_bar', count: 1 }],
  }),
  A({
    id: 'smelt-adamant',
    skillId: 'smithing',
    name: 'Smelt adamant bar',
    description: 'Needs Mythril 40 and Mining 35.',
    tier: 5,
    xp: 34,
    deckLevel: 'zhfreq',
    band: 'adamant',
    bandLevel: 1,
    requires: [{ skill: 'mining', level: 35 }],
    consumes: [
      { item: 'adamant_ore', count: 2 },
      { item: 'coal', count: 4 },
    ],
    produces: [{ item: 'adamant_bar', count: 1 }],
  }),
  A({
    id: 'forge-mythril-sword',
    skillId: 'smithing',
    name: 'Forge mythril sword',
    description: 'Needs Mythril 3 and Mining 20.',
    tier: 4,
    xp: 39,
    deckLevel: 'zhfreq',
    band: 'mythril',
    bandLevel: 3,
    requires: [{ skill: 'mining', level: 20 }],
    consumes: [{ item: 'mythril_bar', count: 30 }],
    produces: [{ item: 'mythril_sword', count: 1 }],
  }),
  A({
    id: 'forge-adamant-plate',
    skillId: 'smithing',
    name: 'Forge adamant platebody',
    description: 'Needs Adamant 24 and Mining 35.',
    tier: 5,
    xp: 90,
    deckLevel: 'jafreq',
    band: 'adamant',
    bandLevel: 24,
    requires: [{ skill: 'mining', level: 35 }],
    consumes: [{ item: 'adamant_bar', count: 38 }],
    produces: [{ item: 'adamant_platebody', count: 1 }],
  }),
  A({
    id: 'forge-steel-legs',
    skillId: 'smithing',
    name: 'Forge steel leggings',
    description: 'Needs Steel 18.',
    tier: 3,
    xp: 38,
    deckLevel: 'jafreq',
    band: 'steel',
    bandLevel: 18,
    consumes: [{ item: 'steel_bar', count: 20 }],
    produces: [{ item: 'steel_legs', count: 1 }],
  }),
  A({
    id: 'forge-mythril-legs',
    skillId: 'smithing',
    name: 'Forge mythril leggings',
    description: 'Needs Mythril 18 and Mining 20.',
    tier: 4,
    xp: 58,
    deckLevel: 'zhfreq',
    band: 'mythril',
    bandLevel: 18,
    requires: [{ skill: 'mining', level: 20 }],
    consumes: [{ item: 'mythril_bar', count: 28 }],
    produces: [{ item: 'mythril_legs', count: 1 }],
  }),
  A({
    id: 'chop-yew',
    skillId: 'woodcutting',
    name: 'Chop yew',
    description: 'Needs Woodcutting 30.',
    tier: 4,
    xp: 22,
    deckLevel: 'jafreq',
    requires: [{ skill: 'woodcutting', level: 30 }],
    produces: [{ item: 'yew_log', count: 1 }],
  }),
  A({
    id: 'fletch-yew-bow',
    skillId: 'fletching',
    name: 'Fletch yew longbow',
    description: 'Needs Yew 3 and Woodcutting 30.',
    tier: 3,
    xp: 58,
    deckLevel: 'zhfreq',
    band: 'yew',
    bandLevel: 3,
    requires: [{ skill: 'woodcutting', level: 30 }],
    consumes: [{ item: 'yew_log', count: 48 }],
    produces: [{ item: 'yew_longbow', count: 1 }],
  }),
  A({
    id: 'farm-ranarr',
    skillId: 'farming',
    name: 'Harvest ranarr',
    description: 'Needs Farming 30.',
    tier: 4,
    xp: 22,
    deckLevel: 'jafreq',
    requires: [{ skill: 'farming', level: 30 }],
    produces: [{ item: 'ranarr', count: 1 }],
  }),
  A({
    id: 'brew-super-attack',
    skillId: 'herblore',
    name: 'Brew super attack potion',
    description: 'Needs Herblore 20 and Farming 25.',
    tier: 4,
    xp: 30,
    deckLevel: 'jafreq',
    requires: [
      { skill: 'herblore', level: 20 },
      { skill: 'farming', level: 25 },
    ],
    consumes: [
      { item: 'ranarr', count: 3 },
      { item: 'vial', count: 3 },
    ],
    produces: [{ item: 'super_attack_potion', count: 1 }],
  }),
  // Jewellery binds a gem into a metal band (§13.5.3.1): the band sets the base, the
  // gem's **type** sets the stat. One set action per tier — pick any gem of the tier.
  ...GEM_TIERS.map((t) =>
    A({
      id: `set-gems-${t.band}`,
      skillId: 'crafting',
      name: `Set ${t.word.toLowerCase()} gems`,
      description: `Set a ${t.word.toLowerCase()} gem into a band.`,
      tier: t.tier,
      xp: 12 + 4 * t.tier,
      deckLevel: 'zhfreq',
      band: t.band,
      bandLevel: 3,
      choices: GEM_TYPES.map((g) => ({
        id: g.id,
        label: `${t.word} ${g.name.toLowerCase()}`,
        consumes: [
          { item: t.metalBand, count: 1 },
          { item: gemId(g.id, t.tier), count: 1 },
        ],
        produces: [{ item: `ring_${g.id}${t.tier}`, count: 1 }],
      })),
    }),
  ),
  // Crushing (§13.5.3.1): break a cut gem into dust for Enchanting. One action —
  // pick any gem, and the dust carries that gem's stat.
  A({
    id: 'crush-gems',
    skillId: 'crafting',
    name: 'Crush gems',
    description: 'Break a cut gem into dust.',
    tier: 1,
    xp: 8,
    deckLevel: 'zhfreq',
    choices: GEM_TYPES.flatMap((g) =>
      GEM_TIERS.map((t) => ({
        id: `${g.id}${t.tier}`,
        label: `${t.word} ${g.name.toLowerCase()}`,
        consumes: [{ item: gemId(g.id, t.tier), count: 1 }],
        produces: [{ item: dustId(g.id), count: 1 }],
      })),
    ),
  }),
  A({
    id: 'craft-sapphire-amulet',
    skillId: 'crafting',
    name: 'String a sapphire amulet',
    description: 'Needs Copper 14.',
    tier: 1,
    xp: 22,
    deckLevel: 'zhfreq',
    band: 'copper',
    bandLevel: 14,
    consumes: [
      { item: 'bronze_band', count: 1 },
      { item: 'cut_gem', count: 24 },
    ],
    produces: [{ item: 'sapphire_amulet', count: 1 }],
  }),
  A({
    id: 'craft-lucky-charm',
    skillId: 'crafting',
    name: 'Craft a lucky charm',
    description: 'Needs Sapphire 8.',
    tier: 2,
    xp: 18,
    deckLevel: 'zhfreq',
    band: 'sapphire',
    bandLevel: 8,
    consumes: [
      { item: 'leather', count: 2 },
      { item: 'cut_gem', count: 2 },
    ],
    produces: [{ item: 'lucky_charm', count: 1 }],
  }),
  A({
    id: 'craft-rune-orb',
    skillId: 'crafting',
    name: 'Craft a rune orb',
    description: 'Needs Sapphire 6.',
    tier: 2,
    xp: 20,
    deckLevel: 'jafreq',
    band: 'sapphire',
    bandLevel: 6,
    consumes: [
      { item: 'cut_gem', count: 2 },
      { item: 'air_rune', count: 2 },
    ],
    produces: [{ item: 'rune_orb', count: 1 }],
  }),
  // Enchanting (§13.5.3.2) has **one** track: Distill. It breaks an item down to
  // learn from it (XP by the item's coin value) and yields its family essence, the
  // reagent every enchant is built from. You pick the item on the Enchanting page.
  A({
    id: 'distill',
    skillId: 'enchanting',
    name: 'Distill',
    description: 'Break an item down to learn from it.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
  }),
  // Enchanting-adjacent gear crafts (now under Crafting; Enchanting is the one track).
  A({
    id: 'enchant-amulet',
    skillId: 'crafting',
    name: 'Enchant sapphire amulet',
    description: 'Needs Sapphire 12.',
    tier: 2,
    xp: 20,
    deckLevel: 'jafreq',
    band: 'sapphire',
    bandLevel: 12,
    consumes: [
      { item: 'sapphire_amulet', count: 1 },
      { item: 'air_rune', count: 8 },
      { item: 'nature_rune', count: 4 },
    ],
    produces: [{ item: 'enchanted_amulet', count: 1 }],
  }),
  A({
    id: 'enchant-robe',
    skillId: 'crafting',
    name: 'Enchant a mystic robe',
    description: 'Needs Mystic 1.',
    tier: 3,
    xp: 26,
    deckLevel: 'zhfreq',
    band: 'mystic',
    bandLevel: 1,
    consumes: [
      { item: 'leather_body', count: 2 },
      { item: 'air_rune', count: 12 },
    ],
    produces: [{ item: 'mystic_robe', count: 1 }],
  }),
  A({
    id: 'enchant-blade',
    skillId: 'crafting',
    name: 'Bind a blessed sword',
    description: 'Needs Mythril 3.',
    tier: 4,
    xp: 34,
    deckLevel: 'zhfreq',
    band: 'mythril',
    bandLevel: 3,
    consumes: [
      { item: 'mythril_sword', count: 1 },
      { item: 'nature_rune', count: 8 },
    ],
    produces: [{ item: 'blessed_sword', count: 1 }],
  }),
  A({
    id: 'enchant-trinket',
    skillId: 'crafting',
    name: 'Enchant a lucky charm',
    description: 'Needs Arcane 6.',
    tier: 3,
    xp: 26,
    deckLevel: 'jafreq',
    band: 'arcane',
    bandLevel: 6,
    consumes: [
      { item: 'lucky_charm', count: 1 },
      { item: 'cut_gem', count: 2 },
      { item: 'nature_rune', count: 2 },
    ],
    produces: [{ item: 'rune_trinket', count: 1 }],
  }),
]

// --- lookups -----------------------------------------------------------------

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]))
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]))
export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))

/**
 * The combat profession a weapon trains. A fight uses whatever you have
 * equipped, so the weapon's tag — not the monster — decides the skill: a melee
 * weapon (sword) trains Strength, a bow trains Ranged, a staff trains Magic.
 * Fighting unarmed is still melee, so it falls back to Strength.
 */
export function weaponSkill(tags: string[] | undefined): SkillId {
  if (tags?.includes('bow')) return 'ranged'
  if (tags?.includes('staff')) return 'magic'
  return 'strength'
}

/**
 * The level an action unlocks at — the highest level any of its `requires`
 * asks for. An action with no requirements is available from level 1. A banded
 * action instead sorts by `tier·1000 + bandLevel`, so a metal's whole set reads
 * together before the next metal starts (§13.5.3).
 */
export function actionRequiredLevel(action: ActionDef): number {
  if (action.band) {
    const band = BAND_BY_ID.get(action.band)
    if (band) return band.tier * 1000 + (action.bandLevel ?? 1)
  }
  return (action.requires ?? []).reduce((n, r) => Math.max(n, r.level), 1)
}

/**
 * A profession's actions, in progression order: the lowest level requirement
 * first, then tier, so a recipe line reads bronze → bronze gear → iron → …
 * instead of by the order the actions happen to be declared in.
 */
export function actionsForSkill(skillId: SkillId): ActionDef[] {
  return ACTIONS.filter((a) => a.skillId === skillId).sort(
    (a, b) => actionRequiredLevel(a) - actionRequiredLevel(b) || a.tier - b.tier,
  )
}

/**
 * Each profession's **derived** level (the mean of its actions' levels, rounded)
 * from a map of action id → level. The same formula `skillLevelOf` uses against
 * the database, but pure — so `computeBonuses` can resolve synergy talents without
 * touching the db.
 */
export function skillLevelsFrom(levels: Map<string, number>): Map<SkillId, number> {
  const out = new Map<SkillId, number>()
  for (const s of SKILLS) {
    const acts = actionsForSkill(s.id)
    if (!acts.length) {
      out.set(s.id, 1)
      continue
    }
    const total = acts.reduce((n, a) => n + Math.max(1, levels.get(a.id) ?? 1), 0)
    out.set(s.id, Math.round(total / acts.length))
  }
  return out
}

export function missingUnlocks(action: ActionDef, levelOf: (s: SkillId) => number): UnlockReq[] {
  return (action.requires ?? []).filter((r) => levelOf(r.skill) < r.level)
}

export function missingMaterials(action: ActionDef, countOf: (i: string) => number): Cost[] {
  return (action.consumes ?? []).filter((c) => countOf(c.item) < c.count)
}

/** Weighted draw from an action's gem table (§13.5.3.1). `rand` is injectable. */
export function rollTable(table: LootEntry[], rand: () => number = Math.random): Cost {
  const total = table.reduce((n, e) => n + Math.max(0, e.weight), 0)
  let r = rand() * total
  for (const e of table) {
    r -= Math.max(0, e.weight)
    if (r < 0) return { item: e.item, count: e.count ?? 1 }
  }
  const last = table[table.length - 1]!
  return { item: last.item, count: last.count ?? 1 }
}

/**
 * Expected produces for a table action. Idle folds the odds into the rig's rate, so
 * a running prospect pays each gem at its share — over time, the whole tier.
 */
export function tableExpected(table: LootEntry[]): Cost[] {
  const total = table.reduce((n, e) => n + Math.max(0, e.weight), 0) || 1
  const out = new Map<string, number>()
  for (const e of table) {
    const p = Math.max(0, e.weight) / total
    out.set(e.item, (out.get(e.item) ?? 0) + p * (e.count ?? 1))
  }
  return [...out].map(([item, count]) => ({ item, count }))
}

/** The choice an action runs (the named one, or its first). Undefined when it has none. */
export function actionChoice(action: ActionDef, choiceId?: string): ActionChoice | undefined {
  const list = action.choices
  if (!list?.length) return undefined
  return list.find((c) => c.id === choiceId) ?? list[0]
}

/** What an action (or one of its choices) consumes. */
export function actionConsumes(action: ActionDef, choiceId?: string): Cost[] {
  const c = actionChoice(action, choiceId)
  return c ? (c.consumes ?? []) : (action.consumes ?? [])
}

/** Expected produces — fixed, or the expected value of a gem table. */
export function actionExpected(action: ActionDef, choiceId?: string): Cost[] {
  const c = actionChoice(action, choiceId)
  const table = c ? c.table : action.table
  if (table) return tableExpected(table)
  return (c ? c.produces : action.produces) ?? []
}

/** One roll of an action: a single table entry, or its fixed produces. */
export function actionRoll(
  action: ActionDef,
  choiceId: string | undefined,
  rand: () => number = Math.random,
): Cost[] {
  const c = actionChoice(action, choiceId)
  const table = c ? c.table : action.table
  if (table) return [rollTable(table, rand)]
  return (c ? c.produces : action.produces) ?? []
}

/** The success odds of an action (or choice) at the given level. */
export function actionOdds(action: ActionDef, choiceId: string | undefined, level: number): number {
  const c = actionChoice(action, choiceId)
  const base = c ? c.successChance : action.successChance
  if (!base || base >= 1) return 1
  const per = (c ? c.successPerLevel : action.successPerLevel) ?? 0
  return Math.min(1, Math.max(0, base + per * (level - 1)))
}
