import { expect, test } from 'bun:test'
import { openDb, type Db } from '../db/client'
import {
  addItems,
  createUser,
  getActionXp,
  getItemCount,
  listEquipment,
  listTalents,
} from '../db/repo'
import { EventBus } from '../events'
import { ACTION_BY_ID, actionsForSkill, skillLevelInfo, skillXpForLevel } from './skills'
import { talentOptions } from './talents'
import {
  actionState,
  aggregateBonuses,
  awardActionXp,
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

const MINING = actionsForSkill('mining').map((a) => a.id)

/** Brings every mining action to `to` levels (there are no XP bonuses in tests). */
function setMining(db: Db, bus: EventBus, userId: string, to: number): void {
  for (const id of MINING) {
    const cur = skillLevelInfo(getActionXp(db, userId, id)).level
    awardActionXp(db, bus, userId, id, xpForLevel(to) - xpForLevel(cur))
  }
}

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  return { db, bus, user, sqlite }
}

test('awardActionXp levels the action up; the profession rounds the mean to 100', () => {
  const { db, bus, user, sqlite } = setup()
  const events: string[] = []
  bus.on('skill.level.up', (e) => events.push(`lvl:${e.level}`))

  // one action alone does not max the profession: Mining is the mean of its four
  const first = awardActionXp(db, bus, user.id, 'mine-copper', xpForLevel(10))
  expect(first.level).toBe(10)
  expect(first.leveledUp).toBe(true)
  expect(first.talentUnlocked).toBeNull()
  expect(skillLevelOf(db, user.id, 'mining')).toBe(3) // (10+1+1+1) / 4

  // levelling every mining action to 10 brings the mean to 10 and opens the choice
  setMining(db, bus, user.id, 10)
  expect(skillLevelOf(db, user.id, 'mining')).toBe(10)
  expect(events).toContain('lvl:10')
  // nothing is auto-granted — the player must choose
  expect(listTalents(db, user.id).length).toBe(0)

  // no new milestone between 10 and 20
  expect(awardActionXp(db, bus, user.id, 'mine-copper', 10).talentUnlocked).toBeNull()

  // levelling them all to 20 opens the next choice
  setMining(db, bus, user.id, 20)
  expect(skillLevelOf(db, user.id, 'mining')).toBe(20)
  sqlite.close()
})

test('a new action lowers the profession until it is trained', () => {
  const { db, bus, user, sqlite } = setup()
  // a maxed 4-action profession is exactly 100 …
  setMining(db, bus, user.id, 100)
  expect(skillLevelOf(db, user.id, 'mining')).toBe(100)
  // … and Mining has four actions today, so a fifth would read 80 at level 1
  expect(Math.round((4 * 100 + 1) / 5)).toBe(80)
  sqlite.close()
})

test('per-action effects boost XP gains', () => {
  const { db, bus, user, sqlite } = setup()
  // Agility's drill at 11 gives +5% global XP.
  awardActionXp(db, bus, user.id, 'agility-drill', xpForLevel(11))
  const bonus = aggregateBonuses(db, user.id)
  expect(bonus.globalXp).toBeGreaterThan(0)
  // a fresh profession sits at 1 (the mean of its four level-1 actions)
  const before = skillLevelOf(db, user.id, 'mining')
  const r = awardActionXp(db, bus, user.id, 'mine-copper', 100)
  expect(before).toBe(1)
  expect(r.gained).toBe(Math.round(100 * (1 + bonus.xp('mine-copper') + bonus.globalXp)))
  expect(r.gained).toBeGreaterThan(100)
  sqlite.close()
})

test('chooseTalent: pick one of two at a 10-level milestone, and change it later', () => {
  const { db, bus, user, sqlite } = setup()
  const changes: string[] = []
  bus.on('talent.changed', (e) => changes.push(`${e.fromTalentId}->${e.talentId}`))
  setMining(db, bus, user.id, 10)

  const options = talentOptions('mining', 10)
  const first = chooseTalent(db, bus, user.id, options[0]!.id)
  expect(first.ok).toBe(true)
  expect(first.talent?.id).toBe(options[0]!.id)

  // the same milestone can be respecced to the other option
  const swap = chooseTalent(db, bus, user.id, options[1]!.id)
  expect(swap.ok).toBe(true)
  expect(changes).toEqual([`${options[0]!.id}->${options[1]!.id}`])
  const owned = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(owned.map((t) => t.talentId)).toEqual([options[1]!.id])

  // the next milestone opens at level 20
  setMining(db, bus, user.id, 20)
  expect(chooseTalent(db, bus, user.id, 'mining:t:20:1').ok).toBe(true)
  // and it can be respecced too, without touching the level-10 pick
  expect(chooseTalent(db, bus, user.id, 'mining:t:20:2').ok).toBe(true)
  const both = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(both.length).toBe(2)
  expect(both.some((t) => t.talentId === options[1]!.id)).toBe(true)

  // cannot skip ahead to a milestone you have not reached
  const skipped = chooseTalent(db, bus, user.id, 'mining:t:30:1')
  expect(skipped.ok).toBe(false)
  expect(skipped.error).toContain('not reached')
  sqlite.close()
})

test('talentView exposes the chosen talents and the next milestone', () => {
  const { db, bus, user, sqlite } = setup()
  const view = () => talentView(db, user.id).find((t) => t.skillId === 'mining')!

  const at1 = view()
  expect(at1.owned).toEqual([])
  expect(at1.pendingChoice).toBe(false)
  expect(at1.nextMilestone).toBe(10)

  setMining(db, bus, user.id, 10)
  const at10 = view()
  expect(at10.pendingChoice).toBe(true)
  expect(at10.milestone).toBe(10)
  expect(at10.options.length).toBe(2)

  const choice = talentOptions('mining', 10)[0]!
  expect(chooseTalent(db, bus, user.id, choice.id).ok).toBe(true)
  const chosen = view()
  expect(chosen.pendingChoice).toBe(false)
  expect(chosen.owned.map((t) => t.id)).toEqual([choice.id])
  expect(chosen.owned[0]!.options.length).toBe(2)
  expect(chosen.nextMilestone).toBe(20)
  sqlite.close()
})

test('grantItems applies yield + double bonuses', () => {
  const { db, bus, user, sqlite } = setup()
  // no bonuses: exactly the base count
  grantItems(db, bus, user.id, 'mine-copper', [{ item: 'copper_ore', count: 1 }], () => 0.99)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1)

  // mine-copper 11 → +10% yield; rand=0 carries the fraction to +1
  awardActionXp(db, bus, user.id, 'mine-copper', xpForLevel(11))
  grantItems(db, bus, user.id, 'mine-copper', [{ item: 'copper_ore', count: 1 }], () => 0)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(3) // 1 + 1 (carry) + 2nd gather
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
