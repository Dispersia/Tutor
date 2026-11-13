import { expect, test } from 'bun:test'
import { applyYield, computeBonuses } from './modifiers'
import {
  ACTIONS,
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  SKILL_BY_ID,
  actionsForSkill,
  missingMaterials,
  missingUnlocks,
  skillLevelInfo,
  skillXpForLevel,
  type SkillId,
} from './skills'
import { parseTalentId, talentMilestones, talentOptions } from './talents'

test('content integrity: ids, references and coverage', () => {
  const skillIds = new Set(SKILLS.map((s) => s.id))
  expect(skillIds.size).toBe(SKILLS.length)

  const itemIds = new Set(ITEMS.map((i) => i.id))
  expect(itemIds.size).toBe(ITEMS.length)

  const actionIds = new Set(ACTIONS.map((a) => a.id))
  expect(actionIds.size).toBe(ACTIONS.length)

  for (const s of SKILLS) {
    expect(actionsForSkill(s.id).length).toBeGreaterThan(0)
  }
  for (const a of ACTIONS) {
    expect(skillIds.has(a.skillId)).toBe(true)
    for (const c of [...(a.consumes ?? []), ...(a.produces ?? [])]) {
      expect(itemIds.has(c.item)).toBe(true)
    }
    for (const r of a.requires ?? []) expect(skillIds.has(r.skill)).toBe(true)
    if (a.equip) {
      expect(['weapon', 'body', 'legs']).toContain(a.equip.slot)
      const anyItem = ITEMS.some((i) => i.slot === a.equip!.slot && i.tags?.includes(a.equip!.tag))
      expect(anyItem).toBe(true)
    }
  }
})

test('combat actions are gated by forged/fletched gear', () => {
  const melee = ACTIONS.find((a) => a.id === 'train-attack')!
  expect(melee.equip).toEqual({ slot: 'weapon', tag: 'melee' })
  const ranged = ACTIONS.find((a) => a.id === 'train-ranged')!
  expect(ranged.equip).toEqual({ slot: 'weapon', tag: 'bow' })
  expect(ranged.consumes?.some((c) => c.item === 'arrow')).toBe(true)
  // swords come from Smithing, bows from Fletching
  expect(ACTIONS.some((a) => a.id === 'forge-bronze-sword')).toBe(true)
  expect(ACTIONS.some((a) => a.id === 'fletch-oak-bow')).toBe(true)
})

test('skill XP curve + level info', () => {
  expect(skillXpForLevel(1)).toBe(50)
  expect(skillXpForLevel(2)).toBe(75)
  expect(skillLevelInfo(0)).toMatchObject({ level: 1, intoLevel: 0, forNext: 50 })
  expect(skillLevelInfo(50)).toMatchObject({ level: 2, intoLevel: 0 })
  expect(skillLevelInfo(125)).toMatchObject({ level: 3 })
})

test('every level increases the skill effect', () => {
  for (const s of SKILLS) {
    expect(s.effect.value).toBeGreaterThan(0)
    expect(s.effectLabel.length).toBeGreaterThan(0)
  }
})

test('unlock + material helpers', () => {
  const mine = ACTIONS.find((a) => a.id === 'mine-iron')!
  expect(missingUnlocks(mine, () => 1).length).toBe(1)
  expect(missingUnlocks(mine, () => 5).length).toBe(0)
  const brew = ACTIONS.find((a) => a.id === 'brew-attack')!
  expect(
    missingMaterials(brew, () => 0)
      .map((c) => c.item)
      .sort(),
  ).toEqual(['guam', 'vial'])
  expect(missingMaterials(brew, () => 1).length).toBe(0)
})

test('talent milestones: every 10 levels', () => {
  expect(talentMilestones(9)).toEqual([])
  expect(talentMilestones(10)).toEqual([10])
  expect(talentMilestones(25)).toEqual([10, 20])
  expect(talentMilestones(30)).toEqual([10, 20, 30])
})

test('talent options: two choices, unique ids, parseable', () => {
  const opts = talentOptions('mining', 10)
  expect(opts.length).toBe(2)
  expect(new Set(opts.map((o) => o.id)).size).toBe(2)
  expect(opts[0]!.description).toContain('yield')
  expect(opts[1]!.description).toContain('XP')
  for (const o of opts) {
    expect(parseTalentId(o.id)).toEqual({ skillId: 'mining', milestone: 10 })
  }
  // combat professions get a power talent instead of yield
  expect(talentOptions('attack', 10)[0]!.description).toContain('power')
  expect(parseTalentId('mining:t:20:2')).toEqual({ skillId: 'mining', milestone: 20 })
  expect(parseTalentId('nope')).toBeNull()
})

test('computeBonuses: per-level effects + talents stack', () => {
  const levels = new Map<SkillId, number>([
    ['mining', 11], // +10% yield
    ['agility', 11], // +5% global XP
  ])
  const b = computeBonuses(levels, [])
  expect(b.yield('mining')).toBeCloseTo(0.1)
  expect(b.globalXp).toBeCloseTo(0.05)

  const withTalent = computeBonuses(levels, [talentOptions('mining', 10)[0]!])
  expect(withTalent.yield('mining')).toBeCloseTo(0.25) // +15% talent
})

test('applyYield applies yield bonus and double chance deterministically', () => {
  expect(applyYield(1, 0, 0, () => 0.99)).toBe(1)
  expect(applyYield(1, 0.5, 0, () => 0)).toBe(2) // 1.5 → floor 1 + carry
  expect(applyYield(1, 0, 1, () => 0)).toBe(2) // guaranteed double
  expect(applyYield(10, 0.1, 0, () => 0.99)).toBe(11)
})

test('items expose equipment slots + tags', () => {
  expect(ITEM_BY_ID.get('bronze_sword')?.slot).toBe('weapon')
  expect(ITEM_BY_ID.get('bronze_sword')?.tags).toContain('melee')
  expect(ITEM_BY_ID.get('oak_shortbow')?.tags).toContain('bow')
  expect(ITEM_BY_ID.get('steel_platebody')?.tags).toContain('armour')
  expect(SKILL_BY_ID.get('mining')?.category).toBe('gathering')
  expect(SKILL_BY_ID.get('smithing')?.category).toBe('artisan')
  expect(SKILL_BY_ID.get('attack')?.category).toBe('combat')
})
