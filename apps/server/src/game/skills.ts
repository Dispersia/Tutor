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
}

export type Slot = 'weapon' | 'body' | 'legs' | 'neck'

export interface Cost {
  item: string
  count: number
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
  consumes?: Cost[]
  produces?: Cost[]
  /** must have an equipped item in `slot` carrying `tag` */
  equip?: { slot: Slot; tag: string }
}

// --- skill XP curve ----------------------------------------------------------

/**
 * XP to advance one **action** level. Kept linear so the level-100 cap stays
 * reachable, but scaled for the idle era: a rig left running earns XP on its own
 * (every craft pays, docs §13.5.1), so the whole curve sits 10× higher than the
 * drill-only days — ~58.4k XP maxes one action, and a whole 4-action profession
 * is ~234k. A full 6-hour run of a maxed rig is worth ~10.8k XP, so capping an
 * action is a handful of "leave it running" sessions, not one.
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
  artisan('crafting', 'Crafting', '💎', 'Cut gems, make vials and leather'),
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

export const ITEMS: ItemDef[] = [
  // ores + essence
  item('copper_ore', 'Copper ore', '🟠', 'raw'),
  item('tin_ore', 'Tin ore', '⚪', 'raw'),
  item('iron_ore', 'Iron ore', '🔘', 'raw'),
  item('coal', 'Coal', '⚫', 'raw'),
  item('rune_essence', 'Rune essence', '🔷', 'raw'),
  // logs
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
  // refined
  item('bronze_bar', 'Bronze bar', '🟫', 'refined'),
  item('iron_bar', 'Iron bar', '⬜', 'refined'),
  item('steel_bar', 'Steel bar', '🔩', 'refined'),
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
  item('hide', 'Hide', '🟤', 'raw'),
  item('leather', 'Leather', '🟫', 'refined'),
  item('ash', 'Ash', '🌫️', 'refined'),
  item('plank', 'Plank', '🟧', 'refined'),
  item('bones', 'Bones', '🦴', 'raw'),
  item('grace', 'Grace', '🕊️', 'other'),
  item('coins', 'Coins', '🪙', 'coin'),
  // equipment
  item('bronze_sword', 'Bronze sword', '🗡️', 'equipment', 'A melee weapon.', {
    slot: 'weapon',
    tags: ['melee'],
    power: 3,
  }),
  item('iron_sword', 'Iron sword', '🗡️', 'equipment', 'A stronger melee weapon.', {
    slot: 'weapon',
    tags: ['melee'],
    power: 6,
  }),
  item('oak_shortbow', 'Oak shortbow', '🏹', 'equipment', 'A ranged weapon.', {
    slot: 'weapon',
    tags: ['bow'],
    power: 4,
  }),
  item('willow_longbow', 'Willow longbow', '🏹', 'equipment', 'A stronger bow.', {
    slot: 'weapon',
    tags: ['bow'],
    power: 8,
  }),
  item('oak_staff', 'Oak staff', '🪄', 'equipment', 'A sorcerer’s staff.', {
    slot: 'weapon',
    tags: ['staff'],
    power: 5,
  }),
  item('leather_body', 'Leather body', '🥋', 'equipment', 'Light armour.', {
    slot: 'body',
    tags: ['armour'],
    armour: 1,
  }),
  item('steel_platebody', 'Steel platebody', '🛡️', 'equipment', 'Heavy armour.', {
    slot: 'body',
    tags: ['armour'],
    armour: 3,
  }),
  // --- tier 4–5 chains (a profession feeds the next, and cross-gated recipes) ---
  item('mythril_ore', 'Mythril ore', '🔵', 'raw'),
  item('adamant_ore', 'Adamant ore', '🟩', 'raw'),
  item('yew_log', 'Yew log', '🪵', 'raw'),
  item('ranarr', 'Ranarr', '🌿', 'raw'),
  item('mythril_bar', 'Mythril bar', '🔹', 'refined'),
  item('adamant_bar', 'Adamant bar', '🟢', 'refined'),
  item('steel_legs', 'Steel leggings', '🦿', 'equipment', 'Leg armour.', {
    slot: 'legs',
    tags: ['armour'],
    armour: 2,
  }),
  item('mythril_legs', 'Mythril leggings', '🦿', 'equipment', 'Leg armour.', {
    slot: 'legs',
    tags: ['armour'],
    armour: 4,
  }),
  item('mythril_sword', 'Mythril sword', '🗡️', 'equipment', 'A keen melee weapon.', {
    slot: 'weapon',
    tags: ['melee'],
    power: 10,
  }),
  item('adamant_platebody', 'Adamant platebody', '🛡️', 'equipment', 'The heaviest armour.', {
    slot: 'body',
    tags: ['armour'],
    armour: 5,
  }),
  item('yew_longbow', 'Yew longbow', '🏹', 'equipment', 'A marksman’s bow.', {
    slot: 'weapon',
    tags: ['bow'],
    power: 12,
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
  // --- jewellery: Crafting cuts the gem, Enchanting binds the runes ---
  item('sapphire_amulet', 'Sapphire amulet', '🔷', 'equipment', 'A cut gem on a chain.', {
    slot: 'neck',
    tags: ['amulet'],
    power: 2,
  }),
  item('enchanted_amulet', 'Amulet of power', '🔮', 'equipment', 'A rune-bound amulet.', {
    slot: 'neck',
    tags: ['amulet'],
    power: 5,
  }),
  item('blessed_sword', 'Blessed sword', '🗡️', 'equipment', 'A mythril blade bound with runes.', {
    slot: 'weapon',
    tags: ['melee'],
    power: 14,
  }),
  item('mystic_robe', 'Mystic robe', '🥋', 'equipment', 'Rune-stitched armour.', {
    slot: 'body',
    tags: ['armour'],
    armour: 4,
  }),
]

// --- actions -----------------------------------------------------------------

const A = (a: ActionDef): ActionDef => a

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

  // Smithing
  A({
    id: 'smelt-bronze',
    skillId: 'smithing',
    name: 'Smelt bronze bar',
    description: 'Copper + tin.',
    tier: 1,
    xp: 10,
    deckLevel: 'zhfreq',
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
    description: 'Needs Smithing 5.',
    tier: 2,
    xp: 14,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'smithing', level: 5 }],
    consumes: [{ item: 'iron_ore', count: 2 }],
    produces: [{ item: 'iron_bar', count: 1 }],
  }),
  A({
    id: 'smelt-steel',
    skillId: 'smithing',
    name: 'Smelt steel bar',
    description: 'Needs Smithing 15.',
    tier: 3,
    xp: 20,
    deckLevel: 'jafreq',
    requires: [{ skill: 'smithing', level: 15 }],
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
    tier: 2,
    xp: 12,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'smithing', level: 3 }],
    consumes: [{ item: 'bronze_bar', count: 12 }],
    produces: [{ item: 'bronze_sword', count: 1 }],
  }),
  A({
    id: 'forge-iron-sword',
    skillId: 'smithing',
    name: 'Forge iron sword',
    description: 'Needs Smithing 10.',
    tier: 3,
    xp: 18,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'smithing', level: 10 }],
    consumes: [{ item: 'iron_bar', count: 20 }],
    produces: [{ item: 'iron_sword', count: 1 }],
  }),
  A({
    id: 'forge-steel-plate',
    skillId: 'smithing',
    name: 'Forge steel platebody',
    description: 'Needs Smithing 25.',
    tier: 4,
    xp: 30,
    deckLevel: 'jafreq',
    requires: [{ skill: 'smithing', level: 25 }],
    consumes: [{ item: 'steel_bar', count: 40 }],
    produces: [{ item: 'steel_platebody', count: 1 }],
  }),

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

  // Fletching
  A({
    id: 'fletch-oak-bow',
    skillId: 'fletching',
    name: 'Fletch oak shortbow',
    description: 'A starter bow.',
    tier: 1,
    xp: 12,
    deckLevel: 'zhfreq',
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
    consumes: [{ item: 'oak_log', count: 1 }],
    produces: [{ item: 'arrow', count: 15 }],
  }),
  A({
    id: 'fletch-willow-bow',
    skillId: 'fletching',
    name: 'Fletch willow longbow',
    description: 'Needs Fletching 10.',
    tier: 2,
    xp: 18,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'fletching', level: 10 }],
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
    consumes: [{ item: 'oak_log', count: 12 }],
    produces: [{ item: 'oak_staff', count: 1 }],
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
    equip: { slot: 'weapon', tag: 'melee' },
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
    equip: { slot: 'weapon', tag: 'melee' },
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
    equip: { slot: 'body', tag: 'armour' },
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
    equip: { slot: 'body', tag: 'armour' },
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
    equip: { slot: 'weapon', tag: 'bow' },
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
    equip: { slot: 'weapon', tag: 'melee' },
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
    description: 'Needs Smithing 20 and Mining 20.',
    tier: 4,
    xp: 26,
    deckLevel: 'jafreq',
    requires: [
      { skill: 'smithing', level: 20 },
      { skill: 'mining', level: 20 },
    ],
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
    description: 'Needs Smithing 35 and Mining 35.',
    tier: 5,
    xp: 34,
    deckLevel: 'zhfreq',
    requires: [
      { skill: 'smithing', level: 35 },
      { skill: 'mining', level: 35 },
    ],
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
    description: 'Needs Smithing 25 and Mining 20.',
    tier: 4,
    xp: 32,
    deckLevel: 'zhfreq',
    requires: [
      { skill: 'smithing', level: 25 },
      { skill: 'mining', level: 20 },
    ],
    consumes: [{ item: 'mythril_bar', count: 30 }],
    produces: [{ item: 'mythril_sword', count: 1 }],
  }),
  A({
    id: 'forge-adamant-plate',
    skillId: 'smithing',
    name: 'Forge adamant platebody',
    description: 'Needs Smithing 40 and Mining 35.',
    tier: 5,
    xp: 44,
    deckLevel: 'jafreq',
    requires: [
      { skill: 'smithing', level: 40 },
      { skill: 'mining', level: 35 },
    ],
    consumes: [{ item: 'adamant_bar', count: 38 }],
    produces: [{ item: 'adamant_platebody', count: 1 }],
  }),
  A({
    id: 'forge-steel-legs',
    skillId: 'smithing',
    name: 'Forge steel leggings',
    description: 'Needs Smithing 15.',
    tier: 3,
    xp: 22,
    deckLevel: 'jafreq',
    requires: [{ skill: 'smithing', level: 15 }],
    consumes: [{ item: 'steel_bar', count: 20 }],
    produces: [{ item: 'steel_legs', count: 1 }],
  }),
  A({
    id: 'forge-mythril-legs',
    skillId: 'smithing',
    name: 'Forge mythril leggings',
    description: 'Needs Smithing 25 and Mining 20.',
    tier: 4,
    xp: 30,
    deckLevel: 'zhfreq',
    requires: [
      { skill: 'smithing', level: 25 },
      { skill: 'mining', level: 20 },
    ],
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
    description: 'Needs Fletching 25 and Woodcutting 30.',
    tier: 4,
    xp: 30,
    deckLevel: 'zhfreq',
    requires: [
      { skill: 'fletching', level: 25 },
      { skill: 'woodcutting', level: 30 },
    ],
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
  A({
    id: 'craft-sapphire-amulet',
    skillId: 'crafting',
    name: 'String a sapphire amulet',
    description: 'Needs Crafting 20.',
    tier: 3,
    xp: 22,
    deckLevel: 'zhfreq',
    requires: [{ skill: 'crafting', level: 20 }],
    consumes: [{ item: 'cut_gem', count: 24 }],
    produces: [{ item: 'sapphire_amulet', count: 1 }],
  }),

  // Enchanting: gems (Crafting) + runes (Runecrafting) become combat gear.
  A({
    id: 'enchant-amulet',
    skillId: 'enchanting',
    name: 'Enchant sapphire amulet',
    description: 'Cut gem + air and nature runes.',
    tier: 1,
    xp: 18,
    deckLevel: 'jafreq',
    consumes: [
      { item: 'sapphire_amulet', count: 1 },
      { item: 'air_rune', count: 8 },
      { item: 'nature_rune', count: 4 },
    ],
    produces: [{ item: 'enchanted_amulet', count: 1 }],
  }),
  A({
    id: 'enchant-robe',
    skillId: 'enchanting',
    name: 'Enchant a mystic robe',
    description: 'Needs Enchanting 13 and Crafting 10.',
    tier: 2,
    xp: 26,
    deckLevel: 'zhfreq',
    requires: [
      { skill: 'enchanting', level: 13 },
      { skill: 'crafting', level: 10 },
    ],
    consumes: [
      { item: 'leather_body', count: 2 },
      { item: 'air_rune', count: 12 },
    ],
    produces: [{ item: 'mystic_robe', count: 1 }],
  }),
  A({
    id: 'enchant-blade',
    skillId: 'enchanting',
    name: 'Bind a blessed sword',
    description: 'Needs Enchanting 20 and Smithing 25.',
    tier: 3,
    xp: 34,
    deckLevel: 'zhfreq',
    requires: [
      { skill: 'enchanting', level: 20 },
      { skill: 'smithing', level: 25 },
    ],
    consumes: [
      { item: 'mythril_sword', count: 1 },
      { item: 'nature_rune', count: 8 },
    ],
    produces: [{ item: 'blessed_sword', count: 1 }],
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

export function actionsForSkill(skillId: SkillId): ActionDef[] {
  return ACTIONS.filter((a) => a.skillId === skillId)
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
