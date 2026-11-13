import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addItems, createUser, getItemCount, listEquipment, listTalents } from '../db/repo'
import { EventBus } from '../events'
import { ACTION_BY_ID, skillXpForLevel } from './skills'
import { minorOptions } from './talents'
import {
  actionState,
  aggregateBonuses,
  awardSkillXp,
  chooseTalent,
  equipItem,
  grantItems,
  skillLevelOf,
  talentView,
  unequipItem,
} from './service'
/** XP needed to reach `level` from scratch. */
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

test('awardSkillXp levels up and auto-grants a major at every 10 levels', () => {
  const { db, bus, user, sqlite } = setup()
  const events: string[] = []
  bus.on('skill.level.up', (e) => events.push(`lvl:${e.level}`))
  bus.on('talent.granted', (e) => events.push(`major:${e.talentId}`))

  const r = awardSkillXp(db, bus, user.id, 'mining', xpForLevel(10))
  expect(r.level).toBe(10)
  expect(r.leveledUp).toBe(true)
  expect(events).toContain('lvl:10')
  expect(events).toContain('major:mining:M:10')
  expect(listTalents(db, user.id).some((t) => t.talentId === 'mining:M:10')).toBe(true)
  // no major for the 20 milestone yet
  expect(listTalents(db, user.id).some((t) => t.talentId === 'mining:M:20')).toBe(false)
  sqlite.close()
})

test('per-level effects boost skill XP gains', () => {
  const { db, bus, user, sqlite } = setup()
  // Agility 11 gives +5% global XP (and its level-10 major adds another +5%).
  awardSkillXp(db, bus, user.id, 'agility', xpForLevel(11))
  const bonus = aggregateBonuses(db, user.id)
  expect(bonus.globalXp).toBeGreaterThan(0)
  const before = skillLevelOf(db, user.id, 'mining')
  const r = awardSkillXp(db, bus, user.id, 'mining', 100)
  expect(before).toBe(1)
  expect(r.gained).toBe(Math.round(100 * (1 + bonus.xp('mining') + bonus.globalXp)))
  expect(r.gained).toBeGreaterThan(100)
  sqlite.close()
})

test('chooseTalent: pick one of three at a milestone, and change it later', () => {
  const { db, bus, user, sqlite } = setup()
  const changes: string[] = []
  bus.on('talent.changed', (e) => changes.push(`${e.fromTalentId}->${e.talentId}`))
  awardSkillXp(db, bus, user.id, 'mining', xpForLevel(5))

  const options = minorOptions('mining', 5)
  const first = chooseTalent(db, bus, user.id, options[0]!.id)
  expect(first.ok).toBe(true)
  expect(first.talent?.id).toBe(options[0]!.id)

  // the same milestone can be respecced to a different option
  const swap = chooseTalent(db, bus, user.id, options[1]!.id)
  expect(swap.ok).toBe(true)
  expect(changes).toEqual([`${options[0]!.id}->${options[1]!.id}`])
  const owned = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(owned.map((t) => t.talentId)).toEqual([options[1]!.id])

  // the next milestone opens at level 15
  awardSkillXp(db, bus, user.id, 'mining', xpForLevel(15) - xpForLevel(5))
  expect(chooseTalent(db, bus, user.id, 'mining:m:15:1').ok).toBe(true)
  // and it can be respecced too, without touching the level-5 pick
  expect(chooseTalent(db, bus, user.id, 'mining:m:15:2').ok).toBe(true)
  const both = listTalents(db, user.id).filter((t) => t.skillId === 'mining' && t.tier === 'minor')
  expect(both.length).toBe(2)
  expect(both.some((t) => t.talentId === options[1]!.id)).toBe(true)

  // cannot skip ahead to a milestone you have not reached
  const skipped = chooseTalent(db, bus, user.id, 'mining:m:25:1')
  expect(skipped.ok).toBe(false)
  expect(skipped.error).toContain('not reached')
  sqlite.close()
})

test('talentView exposes the chosen talents and the next milestones', () => {
  const { db, bus, user, sqlite } = setup()
  const view = () => talentView(db, user.id).find((t) => t.skillId === 'mining')!

  const at1 = view()
  expect(at1.owned).toEqual([])
  expect(at1.pendingChoice).toBe(false)
  expect(at1.nextMinor).toBe(5)
  expect(at1.nextMajor).toBe(10)

  awardSkillXp(db, bus, user.id, 'mining', xpForLevel(5))
  const at5 = view()
  expect(at5.pendingChoice).toBe(true)
  expect(at5.milestone).toBe(5)

  const choice = minorOptions('mining', 5)[0]!
  expect(chooseTalent(db, bus, user.id, choice.id).ok).toBe(true)
  const chosen = view()
  expect(chosen.pendingChoice).toBe(false)
  expect(chosen.owned.map((t) => t.id)).toEqual([choice.id])
  expect(chosen.owned[0]!.tier).toBe('minor')
  expect(chosen.owned[0]!.options.length).toBe(3)
  expect(chosen.nextMinor).toBe(15)
  expect(chosen.nextMajor).toBe(10)
  sqlite.close()
})

test('grantItems applies yield + double bonuses', () => {
  const { db, bus, user, sqlite } = setup()
  // no bonuses: exactly the base count
  grantItems(db, bus, user.id, 'mining', [{ item: 'copper_ore', count: 1 }], () => 0.99)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1)

  // mining 11 → +10% yield; rand=0 carries the fraction to +1
  awardSkillXp(db, bus, user.id, 'mining', xpForLevel(11))
  grantItems(db, bus, user.id, 'mining', [{ item: 'copper_ore', count: 1 }], () => 0)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(3) // 1 + 1 (carry) + 1 (double roll)
  sqlite.close()
})

test('equip / unequip moves gear between bank and slots', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  const res = equipItem(db, bus, user.id, 'bronze_sword')
  expect(res.ok).toBe(true)
  expect(listEquipment(db, user.id)).toEqual([
    expect.objectContaining({ slot: 'weapon', itemId: 'bronze_sword' }),
  ])
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(0)

  unequipItem(db, user.id, 'weapon')
  expect(listEquipment(db, user.id).length).toBe(0)
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)

  expect(equipItem(db, bus, user.id, 'copper_ore').ok).toBe(false) // not equippable
  sqlite.close()
})

test('combat actions require the right equipped gear', () => {
  const { db, bus, user, sqlite } = setup()
  const attack = ACTION_BY_ID.get('train-attack')!
  expect(actionState(db, user.id, attack).equipOk).toBe(false)
  expect(actionState(db, user.id, attack).unlocked).toBe(false)

  addItems(db, user.id, 'bronze_sword', 1)
  equipItem(db, bus, user.id, 'bronze_sword')
  expect(actionState(db, user.id, attack).equipOk).toBe(true)
  expect(actionState(db, user.id, attack).unlocked).toBe(true)

  // a bow does not satisfy a melee requirement
  unequipItem(db, user.id, 'weapon')
  addItems(db, user.id, 'oak_shortbow', 1)
  equipItem(db, bus, user.id, 'oak_shortbow')
  expect(actionState(db, user.id, attack).equipOk).toBe(false)
  sqlite.close()
})
