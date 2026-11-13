import { expect, test } from 'bun:test'
import {
  MONSTERS,
  MONSTER_BY_ID,
  incomingDamage,
  playerMaxHp,
  playerPower,
  rollDrops,
} from './combat'
import { ITEM_BY_ID, SKILL_BY_ID } from './skills'

test('monster content is well-formed and references real items/skills', () => {
  const ids = new Set(MONSTERS.map((m) => m.id))
  expect(ids.size).toBe(MONSTERS.length)
  for (const m of MONSTERS) {
    expect(SKILL_BY_ID.get(m.combatSkill)?.category).toBe('combat')
    expect(m.hp).toBeGreaterThan(0)
    expect(m.damage).toBeGreaterThan(0)
    for (const d of m.drops) expect(ITEM_BY_ID.has(d.item)).toBe(true)
    for (const r of m.requires ?? []) expect(SKILL_BY_ID.has(r.skill)).toBe(true)
    if (m.equip) {
      const anyItem = [...ITEM_BY_ID.values()].some(
        (i) => i.slot === m.equip!.slot && i.tags?.includes(m.equip!.tag),
      )
      expect(anyItem).toBe(true)
    }
  }
  expect(MONSTER_BY_ID.get('dragon')?.equip).toEqual({ slot: 'weapon', tag: 'bow' })
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
  expect(ITEM_BY_ID.get('steel_platebody')?.armour).toBe(3)
})
