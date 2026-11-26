export interface DropDef {
  item: string
  chance: number
  min: number
  max: number
}

export interface MonsterDef {
  id: string
  name: string
  icon: string
  description: string
  level: number
  hp: number
  damage: number
  xp: number
  deckLevel: string
  drops: DropDef[]
}

export const MONSTERS: MonsterDef[] = [
  {
    id: 'slime',
    name: 'Slime',
    icon: '🟢',
    description: 'A wobbly blob. Good first fight.',
    level: 1,
    hp: 15,
    damage: 2,
    xp: 8,
    deckLevel: 'hsk1',
    drops: [
      { item: 'bones', chance: 1, min: 1, max: 1 },
      { item: 'slime_goo', chance: 0.6, min: 1, max: 2 },
    ],
  },
  {
    id: 'goblin',
    name: 'Goblin',
    icon: '👺',
    description: 'Sneaky and quick.',
    level: 5,
    hp: 30,
    damage: 3,
    xp: 12,
    deckLevel: 'hsk1',
    drops: [
      { item: 'bones', chance: 1, min: 1, max: 2 },
      { item: 'coins', chance: 0.8, min: 5, max: 15 },
      { item: 'guam', chance: 0.3, min: 1, max: 1 },
    ],
  },
  {
    id: 'wolf',
    name: 'Wolf',
    icon: '🐺',
    description: 'Fast and territorial.',
    level: 10,
    hp: 55,
    damage: 6,
    xp: 18,
    deckLevel: 'hsk1',
    drops: [
      { item: 'hide', chance: 1, min: 1, max: 2 },
      { item: 'bones', chance: 0.7, min: 1, max: 1 },
      { item: 'wolf_fang', chance: 0.5, min: 1, max: 1 },
    ],
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    icon: '💀',
    description: 'Rattling bones and iron.',
    level: 20,
    hp: 95,
    damage: 10,
    xp: 26,
    deckLevel: 'n5',
    drops: [
      { item: 'bones', chance: 1, min: 2, max: 4 },
      { item: 'iron_ore', chance: 0.5, min: 1, max: 2 },
      { item: 'bone_shard', chance: 0.6, min: 1, max: 2 },
      { item: 'coins', chance: 0.6, min: 20, max: 60 },
    ],
  },
  {
    id: 'imp',
    name: 'Imp',
    icon: '😈',
    description: 'Flickers with rune energy.',
    level: 30,
    hp: 150,
    damage: 14,
    xp: 40,
    deckLevel: 'n5',
    drops: [
      { item: 'air_rune', chance: 0.9, min: 1, max: 3 },
      { item: 'uncut_gem', chance: 0.4, min: 1, max: 1 },
      { item: 'imp_ember', chance: 0.5, min: 1, max: 1 },
      { item: 'bones', chance: 0.5, min: 1, max: 2 },
    ],
  },
  {
    id: 'dragon',
    name: 'Green dragon',
    icon: '🐉',
    description: 'A long fight. Bring food.',
    level: 50,
    hp: 280,
    damage: 22,
    xp: 90,
    deckLevel: 'hsk1',
    drops: [
      { item: 'bones', chance: 1, min: 3, max: 6 },
      { item: 'cut_gem', chance: 0.5, min: 1, max: 2 },
      { item: 'nature_rune', chance: 0.4, min: 1, max: 2 },
      { item: 'hide', chance: 0.6, min: 2, max: 4 },
      { item: 'dragon_scale', chance: 0.5, min: 1, max: 2 },
    ],
  },
]

export const MONSTER_BY_ID = new Map(MONSTERS.map((m) => [m.id, m]))

export function playerMaxHp(hpBonus: number, totalArmour: number, stamina = 0): number {
  return Math.round(20 + hpBonus * 20 + totalArmour * 2 + stamina * 3)
}

export function playerPower(
  combatSkillLevel: number,
  weaponPower: number,
  damageBonus: number,
  primary = 0,
  mastery = 0,
): number {
  return Math.max(
    1,
    Math.round(
      (3 + combatSkillLevel * 1.5 + weaponPower + primary * 0.5) * (1 + damageBonus + mastery),
    ),
  )
}

export function incomingDamage(monsterDamage: number, armour: number): number {
  return Math.max(1, monsterDamage - armour)
}

export function rollDrops(
  drops: DropDef[],
  dropBonus: number,
  rand: () => number = Math.random,
): { item: string; count: number }[] {
  const out: { item: string; count: number }[] = []
  for (const d of drops) {
    if (rand() > Math.min(1, d.chance * (1 + dropBonus))) continue
    const count = d.min + Math.floor(rand() * (d.max - d.min + 1))
    if (count > 0) out.push({ item: d.item, count })
  }
  return out
}
