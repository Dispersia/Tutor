import { expect, test } from 'bun:test'
import { openDb, type Db } from '../db/client'
import {
  addItems,
  createUser,
  getActionXp,
  getItemCount,
  listEquipment,
  listGatherLog,
  listTalents,
} from '../db/repo'
import { EventBus } from '../events'
import {
  ACTION_BY_ID,
  actionsForSkill,
  skillLevelInfo,
  skillXpForLevel,
  type SkillId,
} from './skills'
import { masteryOptions, talentOptions } from './talents'
import {
  actionState,
  aggregateBonuses,
  awardActionXp,
  chooseTalent,
  completeAction,
  equipItem,
  grantItems,
  settleAll,
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

/** Brings every action of `skill` to `to` levels (there are no XP bonuses in tests). */
function setSkill(db: Db, bus: EventBus, userId: string, skill: SkillId, to: number): void {
  for (const a of actionsForSkill(skill)) {
    const cur = skillLevelInfo(getActionXp(db, userId, a.id)).level
    awardActionXp(db, bus, userId, a.id, xpForLevel(to) - xpForLevel(cur))
  }
}

function setMining(db: Db, bus: EventBus, userId: string, to: number): void {
  setSkill(db, bus, userId, 'mining', to)
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

  // one action alone does not max the profession: Mining is the mean of its actions
  const first = awardActionXp(db, bus, user.id, 'mine-copper', xpForLevel(10))
  expect(first.level).toBe(10)
  expect(first.leveledUp).toBe(true)
  expect(first.talentUnlocked).toBeNull()
  // (10 + 6×1) / 7 = 2.29 → 2
  expect(skillLevelOf(db, user.id, 'mining')).toBe(2)

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

test('chooseTalent: pick one of three at a 10-level milestone, and change it later', () => {
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
  expect(at10.options.length).toBe(3)

  const choice = talentOptions('mining', 10)[0]!
  expect(chooseTalent(db, bus, user.id, choice.id).ok).toBe(true)
  const chosen = view()
  expect(chosen.pendingChoice).toBe(false)
  expect(chosen.owned.map((t) => t.id)).toEqual([choice.id])
  expect(chosen.owned[0]!.options.length).toBe(3)
  expect(chosen.nextMilestone).toBe(20)
  // the synergy talent is the third option; nothing taken yet
  expect(chosen.synergy.taken).toEqual([])
  // take it at 20: `taken` records the milestone so the page can show the stacks
  setMining(db, bus, user.id, 20)
  expect(chooseTalent(db, bus, user.id, talentOptions('mining', 20)[2]!.id).ok).toBe(true)
  expect(view().synergy.taken).toEqual([20])
  sqlite.close()
})

test('a mastery capstone needs Lv 50 and a level in the partner profession', () => {
  const { db, bus, user, sqlite } = setup()
  const view = () => talentView(db, user.id).find((t) => t.skillId === 'mining')!

  // Mining's partner (the profession that feeds it) is Smithing.
  setSkill(db, bus, user.id, 'mining', 50)
  const grandmaster = masteryOptions('mining', 50)[0]!
  const blocked = chooseTalent(db, bus, user.id, grandmaster.id)
  expect(blocked.ok).toBe(false)
  expect(blocked.error).toContain('smithing 20')

  // The capstone shows up as pending, with its prerequisite unmet.
  const pending = view().mastery.pending.find((p) => p.milestone === 50)!
  expect(pending.options.map((o) => o.requires[0]!.met)).toEqual([false, false])

  // Train Smithing to 20 → the Grandmaster option opens.
  setSkill(db, bus, user.id, 'smithing', 20)
  expect(view().mastery.pending[0]!.options[0]!.requires[0]!.met).toBe(true)
  expect(chooseTalent(db, bus, user.id, grandmaster.id).ok).toBe(true)

  const mine = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(mine.map((t) => t.tier)).toEqual(['mastery'])
  const after = view()
  expect(after.mastery.owned[0]!.tier).toBe('mastery')
  expect(after.mastery.next).toBe(100)
  // a mastery does not consume a choice milestone: the Lv 10 choice is still open
  expect(after.pendingChoice).toBe(true)
  expect(after.milestone).toBe(10)

  // The Patron option needs the partner higher still, so it is still refused.
  const patron = masteryOptions('mining', 50)[1]!
  const stillBlocked = chooseTalent(db, bus, user.id, patron.id)
  expect(stillBlocked.ok).toBe(false)
  expect(stillBlocked.error).toContain('smithing 30')

  // A free respec applies to masteries too: taking the Lv 100 capstone is separate.
  setSkill(db, bus, user.id, 'mining', 100)
  setSkill(db, bus, user.id, 'smithing', 50)
  expect(chooseTalent(db, bus, user.id, masteryOptions('mining', 100)[1]!.id).ok).toBe(true)
  expect(
    view()
      .mastery.owned.map((t) => t.milestone)
      .sort((a, b) => a - b),
  ).toEqual([50, 100])
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

// --- idle rigs (docs/DESIGN.md §13.5.1) --------------------------------------

test('a drill lands the strike, then the rig keeps gathering while you are away', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 1_000_000_000_000
  const first = completeAction(db, bus, user.id, 'mine-copper', t0)

  // the strike is the old flat yield — a drill still lands one ore
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1)
  expect(first.idle?.completions).toBe(1)
  expect(first.idle?.active).toBe(true)
  expect(first.idle?.intervalSec).toBeGreaterThan(2)

  // come back a minute later: the rig kept working
  const settled = settleAll(db, bus, user.id, t0 + 60_000)
  const ore = getItemCount(db, user.id, 'copper_ore')
  expect(ore).toBeGreaterThan(1)
  expect(settled.gained.find((g) => g.item === 'copper_ore')?.count).toBe(ore - 1)
  sqlite.close()
})

test('settling twice over the same instant never double counts', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 1_500_000_000_000
  completeAction(db, bus, user.id, 'mine-copper', t0)
  const once = settleAll(db, bus, user.id, t0 + 30_000)
  const twice = settleAll(db, bus, user.id, t0 + 30_000)
  expect(once.gained.length).toBeGreaterThan(0)
  expect(twice.gained).toEqual([])
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1 + (once.gained[0]?.count ?? 0))
  sqlite.close()
})

test('an artisan rig turns stock into product and runs out when the bank does', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 2_000_000_000_000
  addItems(db, user.id, 'copper_ore', 20)
  addItems(db, user.id, 'tin_ore', 20)

  const first = completeAction(db, bus, user.id, 'smelt-bronze', t0)
  expect(first.gained.some((g) => g.item === 'bronze_bar')).toBe(true)
  expect(getItemCount(db, user.id, 'copper_ore')).toBeLessThan(20)

  settleAll(db, bus, user.id, t0 + 60_000)
  const bars = getItemCount(db, user.id, 'bronze_bar')
  expect(bars).toBeGreaterThan(1)
  // clamped by the bank: never negative, and the ore was really spent
  const perBar = ACTION_BY_ID.get('smelt-bronze')!.consumes!.find(
    (c) => c.item === 'copper_ore',
  )!.count
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(20 - bars * perBar)
  sqlite.close()
})

test('every powered drill is written to the completion log', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 3_000_000_000_000
  completeAction(db, bus, user.id, 'mine-copper', t0)
  completeAction(db, bus, user.id, 'mine-copper', t0 + 1_000)
  const log = listGatherLog(db, user.id, 'mine-copper')
  expect(log.map((r) => r.completions)).toEqual([1, 2])
  sqlite.close()
})
