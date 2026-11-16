import { expect, test } from 'bun:test'
import {
  MONSTERS,
  MONSTER_BY_ID,
  incomingDamage,
  playerMaxHp,
  playerPower,
  rollDrops,
} from './combat'
import { ITEM_BY_ID, weaponSkill } from './skills'

test('monster content is well-formed and references real items', () => {
  const ids = new Set(MONSTERS.map((m) => m.id))
  expect(ids.size).toBe(MONSTERS.length)
  for (const m of MONSTERS) {
    expect(m.hp).toBeGreaterThan(0)
    expect(m.damage).toBeGreaterThan(0)
    for (const d of m.drops) expect(ITEM_BY_ID.has(d.item)).toBe(true)
  }
  expect(MONSTER_BY_ID.get('dragon')?.hp).toBe(280)
})

test('a weapon decides the trained skill: sword→strength, bow→ranged, staff→magic', () => {
  expect(weaponSkill(ITEM_BY_ID.get('bronze_sword')?.tags)).toBe('strength')
  expect(weaponSkill(ITEM_BY_ID.get('oak_shortbow')?.tags)).toBe('ranged')
  expect(weaponSkill(ITEM_BY_ID.get('oak_staff')?.tags)).toBe('magic')
  // unarmed is still melee
  expect(weaponSkill(undefined)).toBe('strength')
})

test('combat maths: HP, power and armour', () => {
  expect(playerMaxHp(1, 0, 0)).toBe(24) // 20 + 4
  expect(playerMaxHp(10, 0.1, 3)).toBe(20 + 40 + 2 + 6)
  // power grows with the skill and the weapon, and with the damage bonus
  expect(playerPower(1, 3, 0)).toBe(8) // 3 + 1.5 + 3
  expect(playerPower(10, 6, 0)).toBe(24) // 3 + 15 + 6
  expect(playerPower(1, 0, 0.5)).toBe(7) // (3 + 1.5) * 1.5 = 6.75 → 7
  expect(incomingDamage(4, 3)).toBe(1)
  expect(incomingDamage(1, 5)).toBe(1) // never below 1
})

test('rollDrops respects chance and ranges', () => {
  const always = rollDrops([{ item: 'bones', chance: 1, min: 2, max: 2 }], 0, () => 0.99)
  expect(always).toEqual([{ item: 'bones', count: 2 }])
  const never = rollDrops([{ item: 'gem', chance: 0.1, min: 1, max: 1 }], 0, () => 0.5)
  expect(never).toEqual([])
  // drop bonus increases the effective chance
  const boosted = rollDrops([{ item: 'gem', chance: 0.1, min: 1, max: 1 }], 1, () => 0.15)
  expect(boosted).toEqual([{ item: 'gem', count: 1 }])
})

test('equipment carries power / armour values', () => {
  expect(ITEM_BY_ID.get('bronze_sword')?.power).toBe(3)
  expect(ITEM_BY_ID.get('iron_sword')?.power).toBe(6)
  expect(ITEM_BY_ID.get('oak_shortbow')?.power).toBe(4)
  expect(ITEM_BY_ID.get('oak_staff')?.power).toBe(5)
  expect(ITEM_BY_ID.get('steel_platebody')?.armour).toBe(3)
})
