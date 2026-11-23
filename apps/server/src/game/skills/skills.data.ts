/**
 * The professions themselves (docs/DESIGN.md §13.5) — content only.
 */

import type { SkillDef, SkillId } from './types'

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
