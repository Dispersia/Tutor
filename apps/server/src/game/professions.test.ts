import { expect, test } from 'bun:test'
import { applyYield, computeBonuses } from './modifiers'
import {
  ACTIONS,
  ACTION_MAX_LEVEL,
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  SKILL_BY_ID,
  actionLevelInfo,
  actionsForSkill,
  missingMaterials,
  missingUnlocks,
  skillLevelInfo,
  skillXpForLevel,
} from './skills'
import {
  MASTERY_MILESTONES,
  masteryOptions,
  parseTalentId,
  resolveTalents,
  SYNERGY,
  talentMilestones,
  talentOptions,
} from './talents'

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
      expect(['weapon', 'body', 'legs', 'neck']).toContain(a.equip.slot)
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
  expect(skillXpForLevel(1)).toBe(100)
  expect(skillXpForLevel(2)).toBe(110)
  expect(skillLevelInfo(0)).toMatchObject({ level: 1, intoLevel: 0, forNext: 100 })
  expect(skillLevelInfo(100)).toMatchObject({ level: 2, intoLevel: 0 })
  expect(skillLevelInfo(210)).toMatchObject({ level: 3 }) // 100 + 110
  // ~58.4k XP maxes one action — 10× the drill-only curve, so a live rig's
  // passive income doesn't blow through the cap in a single run
  let total = 0
  for (let i = 1; i < ACTION_MAX_LEVEL; i++) total += skillXpForLevel(i)
  expect(total).toBe(58_410)
})

test('action levels cap at 100 (so a profession reads out of 100)', () => {
  expect(actionLevelInfo(0).level).toBe(1)
  expect(actionLevelInfo(1_000).level).toBe(skillLevelInfo(1_000).level)
  expect(actionLevelInfo(10_000_000).level).toBe(ACTION_MAX_LEVEL)
  expect(actionLevelInfo(10_000_000).progress).toBe(1)
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
  expect(missingMaterials(brew, () => 0).length).toBe(2)
  expect(missingMaterials(brew, () => 99).length).toBe(0)
})

test('starter bronze chain is playable from Mining 1 (tin has a source)', () => {
  // Regression: tin ore used to drop only from Mine iron (Mining 5), so the
  // tier-1 bronze recipe was dead content for a fresh account.
  const smelt = ACTIONS.find((a) => a.id === 'smelt-bronze')!
  expect(missingUnlocks(smelt, () => 1)).toEqual([])
  for (const c of smelt.consumes ?? []) {
    const source = ACTIONS.find(
      (a) =>
        missingUnlocks(a, () => 1).length === 0 &&
        (a.produces ?? []).some((p) => p.item === c.item),
    )
    expect(source).toBeDefined()
  }
})

test('talent milestones: every 10 levels', () => {
  expect(talentMilestones(9)).toEqual([])
  expect(talentMilestones(10)).toEqual([10])
  expect(talentMilestones(25)).toEqual([10, 20])
  expect(talentMilestones(30)).toEqual([10, 20, 30])
})

test('talent options: three choices, unique ids, parseable', () => {
  const opts = talentOptions('mining', 10)
  expect(opts.length).toBe(3)
  expect(new Set(opts.map((o) => o.id)).size).toBe(3)
  expect(opts[0]!.description).toContain('yield')
  expect(opts[1]!.description).toContain('XP')
  for (const o of opts) {
    expect(parseTalentId(o.id)).toEqual({ skillId: 'mining', milestone: 10, kind: 'choice' })
  }
  // combat professions get a power talent instead of yield
  expect(talentOptions('attack', 10)[0]!.description).toContain('power')
  expect(parseTalentId('mining:t:20:2')).toEqual({
    skillId: 'mining',
    milestone: 20,
    kind: 'choice',
  })
  expect(parseTalentId('nope')).toBeNull()
})

test('every profession has a cross-profession synergy talent', () => {
  for (const s of SKILLS) {
    const third = talentOptions(s.id, 10)[2]!
    expect(third.name).toBe(SYNERGY[s.id].name)
    const mod = third.mods[0]!
    // the bonus is scoped to the *other* profession and scaled by this one
    expect(mod.skill).toBe(SYNERGY[s.id].target)
    expect(mod.synergy).toBe(s.id)
    expect(mod.skill).not.toBe(s.id)
    expect(third.description).toContain(SKILL_BY_ID.get(SYNERGY[s.id].target)!.name)
  }
})

test('a synergy talent grows with the owning profession, not the target', () => {
  // Mine copper pumped to level 21 → Mining's derived level is the mean of its
  // six actions, so (21 + 5×1) / 6 = 4.33 → 4.
  const levels = new Map<string, number>([['mine-copper', 21]])
  const mining = computeBonuses(levels, [])
  const talent = talentOptions('mining', 10)[2]! // Ore Sense → Smithing XP
  const withTalent = computeBonuses(levels, [talent])
  const miningLevel = Math.round((21 + 1 + 1 + 1 + 1 + 1) / 6)
  expect(miningLevel).toBe(4)
  expect(withTalent.xp('smelt-bronze')).toBeCloseTo(0.005 * miningLevel)
  // it does not boost Smithing's own actions' level-derived yield
  expect(withTalent.yield('smelt-bronze')).toBeCloseTo(mining.yield('smelt-bronze'))
})

test('mastery capstones: two options at Lv 50 and 100, each gated on the partner', () => {
  for (const s of SKILLS) {
    for (const milestone of MASTERY_MILESTONES) {
      const opts = masteryOptions(s.id, milestone)
      expect(opts.length).toBe(2)
      expect(new Set(opts.map((o) => o.id)).size).toBe(2)
      const partner = SYNERGY[s.id].target
      for (const o of opts) {
        expect(o.tier).toBe('mastery')
        // every capstone demands a level in the profession that feeds this one
        expect(o.requires.map((r) => r.skill)).toEqual([partner])
        expect(o.requires[0]!.level).toBeGreaterThan(0)
        expect(parseTalentId(o.id)).toEqual({
          skillId: s.id,
          milestone,
          kind: 'mastery',
        })
      }
      // option 1 grows *this* profession; option 2 gifts the partner, scaled by this one
      const self = opts[0]!.mods[0]!
      expect(self.synergy).toBeUndefined()
      expect(opts[1]!.mods[0]!.skill).toBe(partner)
      expect(opts[1]!.mods[0]!.synergy).toBe(s.id)

      if (milestone >= 100) {
        // At 100 the profession is maxed, so its XP would be worthless: the
        // Legendary capstone grants the profession's own *output* instead.
        expect(self.kind).not.toBe('xp')
        expect(self.kind).toBe(SKILL_BY_ID.get(s.id)!.effect.kind)
        expect(self.value).toBeGreaterThan(0)
        // scoped kinds target the profession; global kinds (damage, drop, hp,
        // global_xp) ignore scope
        if (['yield', 'double', 'coins'].includes(self.kind)) expect(self.skill).toBe(s.id)
        else expect(self.skill).toBeUndefined()
        expect(opts[0]!.description).toContain('forever')
      } else {
        // At 50 you still need the XP, so the Grandmaster accelerates this line.
        expect(self.kind).toBe('xp')
        expect(self.skill).toBe(s.id)
      }
    }
  }
})

test('no Lv-100 capstone grants XP — a maxed profession cannot spend it', () => {
  for (const s of SKILLS) {
    for (const o of masteryOptions(s.id, 100)) {
      for (const m of o.mods) {
        // the only XP a capstone may hand out is to the *partner* line, which is
        // not maxed; never XP back into the profession that is already at 100
        if (m.kind === 'xp') expect(m.skill).toBe(SYNERGY[s.id].target)
      }
    }
  }
})

test('a mastery Patron scales with the owning profession, and resolveTalents finds it', () => {
  const levels = new Map<string, number>([['mine-copper', 21]]) // Mining derived 4
  const patron = masteryOptions('mining', 50)[1]! // Patron of Smithing
  const withPatron = computeBonuses(levels, [patron])
  expect(withPatron.xp('smelt-bronze')).toBeCloseTo(0.005 * 4)
  // the self option instead boosts Mining's own actions
  const grandmaster = masteryOptions('mining', 50)[0]!
  expect(computeBonuses(levels, [grandmaster]).xp('mine-copper')).toBeCloseTo(0.25)
  // owned rows resolve back to their definitions, mastery ids included
  expect(resolveTalents([{ talentId: grandmaster.id }]).map((t) => t.id)).toEqual([grandmaster.id])
})

test('computeBonuses: per-action levels + talents stack', () => {
  const levels = new Map<string, number>([
    ['mine-copper', 11], // +10% copper
    ['agility-drill', 11], // +5% global XP
  ])
  const b = computeBonuses(levels, [])
  expect(b.yield('mine-copper')).toBeCloseTo(0.1)
  // the level lives on the action: a sibling action gains nothing
  expect(b.yield('mine-essence')).toBeCloseTo(0)
  expect(b.globalXp).toBeCloseTo(0.05)

  // a talent is scoped to the whole profession, so it boosts every action
  const withTalent = computeBonuses(levels, [talentOptions('mining', 10)[0]!])
  expect(withTalent.yield('mine-copper')).toBeCloseTo(0.25) // +15% talent
  expect(withTalent.yield('mine-essence')).toBeCloseTo(0.15)
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

test('the chains build on each other: multi-profession gates and new slots', () => {
  // Enchanting is the rune-bound artisan: gems (Crafting) + runes (Runecrafting).
  expect(SKILL_BY_ID.get('enchanting')?.category).toBe('artisan')
  const enchant = ACTIONS.find((a) => a.id === 'enchant-amulet')!
  expect(enchant.skillId).toBe('enchanting')
  expect(enchant.consumes?.map((c) => c.item).sort()).toEqual([
    'air_rune',
    'nature_rune',
    'sapphire_amulet',
  ])
  // a cross-gated recipe needs a level in *two* professions
  const superAttack = ACTIONS.find((a) => a.id === 'brew-super-attack')!
  expect(superAttack.requires?.map((r) => r.skill).sort()).toEqual(['farming', 'herblore'])
  // every recipe's inputs are themselves craftable or gathered somewhere
  const produced = new Set(ACTIONS.flatMap((a) => (a.produces ?? []).map((c) => c.item)))
  for (const a of ACTIONS) for (const c of a.consumes ?? []) expect(produced.has(c.item)).toBe(true)
  // legs and neck are worn, and their power/armour is real equipment
  expect(ITEM_BY_ID.get('steel_legs')?.slot).toBe('legs')
  expect(ITEM_BY_ID.get('enchanted_amulet')?.slot).toBe('neck')
  expect(ITEM_BY_ID.get('enchanted_amulet')?.power).toBeGreaterThan(0)
})
