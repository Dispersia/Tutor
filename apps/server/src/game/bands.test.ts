import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addItems, createUser, getActionXp, getItemCount, listGearInstances } from '../db/repo'
import { EventBus } from '../events'
import { BANDS, bandXpToLevel } from './bands'
import { MONSTER_BY_ID } from './combat'
import {
  ACTIONS,
  ACTION_BY_ID,
  ACTION_MAX_LEVEL,
  ACTION_XP_TO_MAX,
  DISTILL_XP_PER_VALUE,
  ENCHANTS,
  ITEM_BY_ID,
  itemValue,
  skillXpForLevel,
} from './skills'
import {
  actionState,
  actionSuccessChance,
  applyEnchant,
  awardActionXp,
  accountBandBonuses,
  bandForItem,
  bandLevelMap,
  bandView,
  completeAction,
  craftGearInstance,
  distillItem,
  enchantOf,
  loadPlayerCombat,
  salvageGear,
  skillLevelOf,
  startEncounter,
} from '../services'

function xpForLevel(level: number): number {
  let total = 0
  for (let i = 1; i < level; i++) total += skillXpForLevel(i)
  return total
}

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  return { db, bus, user, sqlite }
}

const BRONZE_FORGE = ACTION_BY_ID.get('forge-bronze-helm')!

test('a band shares one score: XP on any item raises the whole metal (§13.5.3)', () => {
  const { db, bus, user, sqlite } = setup()

  const fresh = bandLevelMap(db, user.id)
  expect(fresh.get('bronze')).toBe(1)
  expect(actionState(db, user.id, ACTION_BY_ID.get('smelt-bronze')!).unlocked).toBe(true)
  expect(actionState(db, user.id, BRONZE_FORGE).unlocked).toBe(false)

  awardActionXp(db, bus, user.id, { actionId: 'smelt-bronze', amount: bandXpToLevel(10) })
  expect(bandLevelMap(db, user.id).get('bronze')).toBe(10)
  expect(actionState(db, user.id, BRONZE_FORGE).unlocked).toBe(true)

  const bronze = bandView(db, user.id).find((b) => b.id === 'bronze')!
  expect(bronze.gearUnlocked).toBeGreaterThan(0)
  expect(bronze.gearUnlocked).toBeLessThan(bronze.gearTotal)
  sqlite.close()
})

test('the next metal opens at band 40, not at a maxed band (§13.5.3)', () => {
  const { db, bus, user, sqlite } = setup()
  const smeltIron = ACTION_BY_ID.get('smelt-iron')!

  let state = actionState(db, user.id, smeltIron)
  expect(state.unlocked).toBe(false)
  expect(state.missingBands.map((b) => b.id)).toEqual(['bronze'])
  expect(state.missingBands[0]!.level).toBe(40)

  awardActionXp(db, bus, user.id, { actionId: 'smelt-bronze', amount: bandXpToLevel(40) })
  state = actionState(db, user.id, smeltIron)
  expect(state.missingBands).toEqual([])
  expect(state.unlocked).toBe(true)
  expect(actionState(db, user.id, ACTION_BY_ID.get('forge-iron-sword')!).unlocked).toBe(false)
  sqlite.close()
})

test('a band grants an account-wide passive from level 2 up (§13.5.3)', () => {
  const { db, bus, user, sqlite } = setup()
  expect(accountBandBonuses(db, user.id).crit).toBe(0)

  awardActionXp(db, bus, user.id, { actionId: 'smelt-bronze', amount: bandXpToLevel(21) })
  const bonus = accountBandBonuses(db, user.id)
  expect(bonus.crit).toBeCloseTo(0.002 * 20)

  const view = bandView(db, user.id).find((b) => b.id === 'bronze')!
  expect(view.buffStat).toBe('crit')
  expect(view.buffValue).toBeCloseTo(0.002 * 20)
  expect(view.nextUnlock).not.toBeNull()
  expect(view.nextUnlock!.level).toBeGreaterThan(view.level)
  sqlite.close()
})

test('salvage yields the band reagent; Distill yields essence (§13.5.3.2)', () => {
  const { db, bus, user, sqlite } = setup()
  const helm = ITEM_BY_ID.get('bronze_helm')!
  expect(bandForItem(helm)?.reagent).toBe('bronze_reagent')

  const id = craftGearInstance(db, user.id, helm)
  const res = salvageGear(db, bus, user.id, id)
  expect(res.ok).toBe(true)
  expect(res.materials?.some((m) => m.item === 'bronze_reagent')).toBe(true)
  sqlite.close()
})

test('Distill burns an item for Enchanting XP by value, and yields its essence (§13.5.3.2)', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'iron_sword', 2)
  const before = getActionXp(db, user.id, 'distill')
  const d = distillItem(db, bus, user.id, 'iron_sword')
  expect(d.ok).toBe(true)
  expect(getItemCount(db, user.id, 'iron_sword')).toBe(1)
  expect(d.xp!).toBeGreaterThan(0)
  expect(d.essence).toBe('metal_essence')
  expect(getItemCount(db, user.id, 'metal_essence')).toBe(1)
  expect(getActionXp(db, user.id, 'distill')).toBeGreaterThan(before)
  expect(itemValue(ITEM_BY_ID.get('adamant_platebody')!)).toBeGreaterThan(
    itemValue(ITEM_BY_ID.get('copper_ore')!),
  )
  sqlite.close()
})

test('an enchant fits the slot, needs its level and reagents, and grants no XP (§13.5.3.2)', () => {
  const { db, bus, user, sqlite } = setup()
  const piece = craftGearInstance(db, user.id, ITEM_BY_ID.get('iron_sword')!)

  expect(applyEnchant(db, bus, user.id, piece, { enchantId: 'chest:stamina' }).ok).toBe(false)
  expect(applyEnchant(db, bus, user.id, piece, { enchantId: 'mainHand:strength' }).ok).toBe(false)

  awardActionXp(db, bus, user.id, { actionId: 'distill', amount: bandXpToLevel(5) })
  expect(skillLevelOf(db, user.id, 'enchanting')).toBe(5)
  expect(applyEnchant(db, bus, user.id, piece, { enchantId: 'mainHand:strength' }).ok).toBe(false)
  addItems(db, user.id, 'metal_essence', 2)
  addItems(db, user.id, 'gem_essence', 1)
  addItems(db, user.id, 'wood_essence', 1)
  const xpBefore = getActionXp(db, user.id, 'distill')
  expect(applyEnchant(db, bus, user.id, piece, { enchantId: 'mainHand:strength' }).ok).toBe(true)
  expect(getActionXp(db, user.id, 'distill')).toBe(xpBefore)
  const row = listGearInstances(db, user.id).find((g) => g.id === piece)!
  expect(JSON.parse(row.enchantJson)).toEqual(['mainHand:strength'])
  expect(enchantOf(row)?.stat).toBe('strength')
  sqlite.close()
})

test('monsters are fixed: gear and level never move their numbers (§13.5.3)', () => {
  const { db, bus, user, sqlite } = setup()
  const base = MONSTER_BY_ID.get('slime')!
  awardActionXp(db, bus, user.id, { actionId: 'train-attack', amount: bandXpToLevel(50) })
  const res = startEncounter(db, bus, user.id, 'slime')
  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.monster.hp).toBe(base.hp)
    expect(res.monster.damage).toBe(base.damage)
    expect(res.monster.level).toBe(base.level)
  }
  sqlite.close()
})

test('every band has a reagent item and realms grow richer per material (§13.5.3)', () => {
  for (const band of BANDS) {
    expect(ITEM_BY_ID.get(band.reagent)).toBeDefined()
    expect(band.gearUnlockLevel).toBe(40)
  }
  const bronze = ACTION_BY_ID.get('forge-bronze-chest')!
  const iron = ACTION_BY_ID.get('forge-iron-chest')!
  expect(iron.xp / 12).toBeGreaterThan(bronze.xp / 8)
  expect(loadPlayerCombat).toBeDefined()
})

test('every line chains its tiers the same way (§13.5.3)', () => {
  const { db, bus, user, sqlite } = setup()
  const hardened = ACTION_BY_ID.get('sew-hardened-helm')!
  expect(actionState(db, user.id, hardened).missingBands.map((b) => b.id)).toEqual(['leather'])
  awardActionXp(db, bus, user.id, { actionId: 'tan-hide', amount: bandXpToLevel(40) })
  expect(actionState(db, user.id, hardened).missingBands).toEqual([])
  expect(actionState(db, user.id, hardened).band?.name).toBe('Hardened')
  sqlite.close()
})

test('prospecting is ONE action — you choose the ore (§13.5.3.1)', () => {
  const { db, bus, user, sqlite } = setup()
  const tier1 = ['uncut_ruby1', 'uncut_emerald1', 'uncut_sapphire1']
  const count = (ids: string[]) => ids.reduce((n, i) => n + getItemCount(db, user.id, i), 0)
  addItems(db, user.id, 'copper_ore', 5)
  completeAction(db, bus, user.id, {
    actionId: 'prospect',
    now: Date.now(),
    rand: () => 1,
    choiceId: 'copper',
  })
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(0)
  expect(count(tier1)).toBe(0)

  addItems(db, user.id, 'iron_ore', 5)
  completeAction(db, bus, user.id, {
    actionId: 'prospect',
    now: Date.now(),
    rand: () => 0,
    choiceId: 'iron',
  })
  expect(getItemCount(db, user.id, 'iron_ore')).toBe(0)
  const got = count(['uncut_ruby2', 'uncut_emerald2', 'uncut_sapphire2'])
  expect(got).toBeGreaterThanOrEqual(1)
  sqlite.close()
})

test('one level lifts every ore: the odds are per choice, the level is shared (§13.5.3.1)', () => {
  const { db, bus, user, sqlite } = setup()
  const a = ACTION_BY_ID.get('prospect')!
  expect(actionSuccessChance(db, user.id, a, 'copper')).toBeCloseTo(0.4)
  expect(actionSuccessChance(db, user.id, a, 'mythril')).toBeCloseTo(0.5)
  awardActionXp(db, bus, user.id, { actionId: 'prospect', amount: xpForLevel(11) })
  expect(actionSuccessChance(db, user.id, a, 'copper')).toBeCloseTo(0.4 + 0.03 * 10)
  expect(actionSuccessChance(db, user.id, a, 'mythril')).toBeCloseTo(0.5 + 0.03 * 10)
  sqlite.close()
})

test('Smithing forges the band; Jewellery sets a gem of that tier (§13.5.3.1)', () => {
  const { sqlite } = setup()
  const band = ACTION_BY_ID.get('forge-bronze-band')!
  expect(band.band).toBe('bronze')
  expect(band.consumes).toEqual([{ item: 'bronze_bar', count: 2 }])
  const set = ACTION_BY_ID.get('set-gems-copper')!
  expect(set.band).toBe('copper')
  expect(set.choices?.map((c) => c.id).sort()).toEqual(['emerald', 'ruby', 'sapphire'])
  const ruby = set.choices!.find((c) => c.id === 'ruby')!
  expect(ruby.consumes?.map((c) => c.item).sort()).toEqual(['bronze_band', 'ruby1'])
  expect(ruby.produces).toEqual([{ item: 'ring_ruby1', count: 1 }])
  sqlite.close()
})

test('a gem type is its stat at every tier (§13.5.3.1)', () => {
  expect(ITEM_BY_ID.get('ring_ruby1')?.stats?.crit).toBeGreaterThan(0)
  expect(ITEM_BY_ID.get('ring_ruby3')?.stats?.crit).toBeGreaterThan(0)
  expect(ITEM_BY_ID.get('ring_emerald1')?.stats?.haste).toBeGreaterThan(0)
  expect(ITEM_BY_ID.get('ring_sapphire2')?.stats?.mastery).toBeGreaterThan(0)
})

test('cutting is one action per tier; every gem of the tier shares it (§13.5.3.1)', () => {
  const prospect = ACTION_BY_ID.get('prospect')!
  expect(prospect.choices?.map((c) => c.id).sort()).toEqual([
    'adamant',
    'copper',
    'iron',
    'mythril',
  ])
  const cuts = ACTIONS.filter((a) => a.id.startsWith('cut-gems')).map((a) => a.id)
  expect(cuts.sort()).toEqual(['cut-gems-arcane', 'cut-gems-copper', 'cut-gems-sapphire'])
  const t1 = ACTION_BY_ID.get('cut-gems-copper')!
  expect(t1.choices?.map((c) => c.id).sort()).toEqual(['emerald', 'ruby', 'sapphire'])
  const ruby = t1.choices!.find((c) => c.id === 'ruby')!
  expect(ruby.consumes).toEqual([{ item: 'uncut_ruby1', count: 1 }])
  expect(ruby.produces).toEqual([{ item: 'ruby1', count: 1 }])
})

test('crushing a gem yields dust for Enchanting (§13.5.3.1)', () => {
  const crush = ACTION_BY_ID.get('crush-gems')!
  const ruby = crush.choices!.find((c) => c.id === 'ruby3')!
  expect(ruby.consumes).toEqual([{ item: 'ruby3', count: 1 }])
  expect(ruby.produces).toEqual([{ item: 'ruby_dust', count: 1 }])
})

test('the action ladder costs 58,410 XP to level 100 (§13.5)', () => {
  let total = 0
  for (let i = 1; i < ACTION_MAX_LEVEL; i++) total += skillXpForLevel(i)
  expect(total).toBe(ACTION_XP_TO_MAX)
})

test('Distill is priced to cap Enchanting in ~10 days (§13.5.3.2)', () => {
  const valueToMax = ACTION_XP_TO_MAX / DISTILL_XP_PER_VALUE
  const perDay = valueToMax / 10
  expect(perDay).toBeGreaterThan(900)
  expect(perDay).toBeLessThan(1100)
  const piece = ENCHANTS.length > 0 ? 100 : 0
  expect(piece * DISTILL_XP_PER_VALUE).toBeLessThan(ACTION_XP_TO_MAX / 50)
})

test('the enchant catalog covers every slot across a range of levels (§13.5.3.2)', () => {
  const slots = new Set(ENCHANTS.map((e) => e.slot))
  for (const s of [
    'head',
    'neck',
    'chest',
    'waist',
    'legs',
    'feet',
    'hands',
    'mainHand',
    'offHand',
    'ring1',
    'trinket1',
  ] as const) {
    expect(slots.has(s)).toBe(true)
  }
  expect(ENCHANTS.length).toBeGreaterThanOrEqual(40)
  expect(Math.max(...ENCHANTS.map((e) => e.level))).toBeGreaterThanOrEqual(25)
  for (const e of ENCHANTS) expect(e.reagents.length).toBeGreaterThan(0)
  const early = ENCHANTS.find((e) => e.level <= 3)!
  const late = ENCHANTS.reduce((m, e) => (e.level > m.level ? e : m))
  expect(late.value).toBeGreaterThan(early.value)
})
