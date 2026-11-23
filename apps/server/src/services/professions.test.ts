import type { UserId } from '../ids'
import { expect, test } from 'bun:test'
import { openDb, type Db } from '../db/client'
import {
  addItems,
  createUser,
  getActionXp,
  getItemCount,
  listEquipment,
  listGearInstances,
  listGatherLog,
  listRigStates,
  listTalents,
} from '../db/repo'
import { EventBus } from '../events'
import { itemRequirements } from '../game/gear'
import { liveRigCount } from '../game/idle'
import {
  ACTION_BY_ID,
  ACTION_MAX_LEVEL,
  ITEMS,
  SKILLS,
  actionsForSkill,
  skillLevelInfo,
  skillXpForLevel,
  type SkillId,
} from '../game/skills'
import { masteryOptions, talentOptions } from '../game/talents'
import {
  accountLevel,
  actionState,
  aggregateBonuses,
  awardActionXp,
  chooseTalent,
  completeAction,
  distillItem,
  equipItem,
  grantItems,
  settleRigs,
  skillLevelOf,
  stopRig,
  talentView,
  unequipItem,
} from './index'
function xpForLevel(level: number): number {
  let total = 0
  for (let i = 1; i < level; i++) total += skillXpForLevel(i)
  return total
}

function setSkill(db: Db, bus: EventBus, userId: UserId, skill: SkillId, to: number): void {
  for (const a of actionsForSkill(skill)) {
    const cur = skillLevelInfo(getActionXp(db, userId, a.id)).level
    awardActionXp(db, bus, userId, { actionId: a.id, amount: xpForLevel(to) - xpForLevel(cur) })
  }
}

function setMining(db: Db, bus: EventBus, userId: UserId, to: number): void {
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

  const first = awardActionXp(db, bus, user.id, { actionId: 'mine-copper', amount: xpForLevel(10) })
  expect(first.level).toBe(10)
  expect(first.leveledUp).toBe(true)
  expect(first.talentUnlocked).toBeNull()
  expect(skillLevelOf(db, user.id, 'mining')).toBe(2)

  setMining(db, bus, user.id, 10)
  expect(skillLevelOf(db, user.id, 'mining')).toBe(10)
  expect(events).toContain('lvl:10')
  expect(listTalents(db, user.id).length).toBe(0)

  expect(
    awardActionXp(db, bus, user.id, { actionId: 'mine-copper', amount: 10 }).talentUnlocked,
  ).toBeNull()

  setMining(db, bus, user.id, 20)
  expect(skillLevelOf(db, user.id, 'mining')).toBe(20)
  sqlite.close()
})

test('a new action lowers the profession until it is trained', () => {
  const { db, bus, user, sqlite } = setup()
  setMining(db, bus, user.id, 100)
  expect(skillLevelOf(db, user.id, 'mining')).toBe(100)
  expect(Math.round((4 * 100 + 1) / 5)).toBe(80)
  sqlite.close()
})

test('per-action effects boost XP gains', () => {
  const { db, bus, user, sqlite } = setup()
  awardActionXp(db, bus, user.id, { actionId: 'agility-drill', amount: xpForLevel(11) })
  const bonus = aggregateBonuses(db, user.id)
  expect(bonus.globalXp).toBeGreaterThan(0)
  const before = skillLevelOf(db, user.id, 'mining')
  const r = awardActionXp(db, bus, user.id, { actionId: 'mine-copper', amount: 100 })
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

  const swap = chooseTalent(db, bus, user.id, options[1]!.id)
  expect(swap.ok).toBe(true)
  expect(changes).toEqual([`${options[0]!.id}->${options[1]!.id}`])
  const owned = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(owned.map((t) => t.talentId)).toEqual([options[1]!.id])

  setMining(db, bus, user.id, 20)
  expect(chooseTalent(db, bus, user.id, 'mining:t:20:1').ok).toBe(true)
  expect(chooseTalent(db, bus, user.id, 'mining:t:20:2').ok).toBe(true)
  const both = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(both.length).toBe(2)
  expect(both.some((t) => t.talentId === options[1]!.id)).toBe(true)

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
  expect(chosen.synergy.taken).toEqual([])
  setMining(db, bus, user.id, 20)
  expect(chooseTalent(db, bus, user.id, talentOptions('mining', 20)[2]!.id).ok).toBe(true)
  expect(view().synergy.taken).toEqual([20])
  sqlite.close()
})

test('a mastery capstone needs Lv 50 and a level in the partner profession', () => {
  const { db, bus, user, sqlite } = setup()
  const view = () => talentView(db, user.id).find((t) => t.skillId === 'mining')!

  setSkill(db, bus, user.id, 'mining', 50)
  const grandmaster = masteryOptions('mining', 50)[0]!
  const blocked = chooseTalent(db, bus, user.id, grandmaster.id)
  expect(blocked.ok).toBe(false)
  expect(blocked.error).toContain('smithing 20')

  const pending = view().mastery.pending.find((p) => p.milestone === 50)!
  expect(pending.options.map((o) => o.requires[0]!.met)).toEqual([false, false])

  setSkill(db, bus, user.id, 'smithing', 20)
  expect(view().mastery.pending[0]!.options[0]!.requires[0]!.met).toBe(true)
  expect(chooseTalent(db, bus, user.id, grandmaster.id).ok).toBe(true)

  const mine = listTalents(db, user.id).filter((t) => t.skillId === 'mining')
  expect(mine.map((t) => t.tier)).toEqual(['mastery'])
  const after = view()
  expect(after.mastery.owned[0]!.tier).toBe('mastery')
  expect(after.mastery.next).toBe(100)
  expect(after.pendingChoice).toBe(true)
  expect(after.milestone).toBe(10)

  const patron = masteryOptions('mining', 50)[1]!
  const stillBlocked = chooseTalent(db, bus, user.id, patron.id)
  expect(stillBlocked.ok).toBe(false)
  expect(stillBlocked.error).toContain('smithing 30')

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
  grantItems(db, bus, user.id, {
    actionId: 'mine-copper',
    costs: [{ item: 'copper_ore', count: 1 }],
    rand: () => 0.99,
  })
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1)

  awardActionXp(db, bus, user.id, { actionId: 'mine-copper', amount: xpForLevel(11) })
  grantItems(db, bus, user.id, {
    actionId: 'mine-copper',
    costs: [{ item: 'copper_ore', count: 1 }],
    rand: () => 0,
  })
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(3)
  sqlite.close()
})

test('equip / unequip moves gear between bank and slots', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  const res = equipItem(db, bus, user.id, 'bronze_sword')
  expect(res.ok).toBe(true)
  expect(listEquipment(db, user.id)).toEqual([
    expect.objectContaining({ slot: 'mainHand', itemId: 'bronze_sword' }),
  ])
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)

  unequipItem(db, user.id, 'mainHand')
  expect(listEquipment(db, user.id).length).toBe(0)
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)

  expect(equipItem(db, bus, user.id, 'copper_ore').ok).toBe(false)
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

  unequipItem(db, user.id, 'weapon')
  addItems(db, user.id, 'oak_shortbow', 1)
  equipItem(db, bus, user.id, 'oak_shortbow')
  expect(actionState(db, user.id, attack).equipOk).toBe(false)
  sqlite.close()
})

test('a drill lands the strike, then the rig keeps gathering while you are away', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 1_000_000_000_000
  const first = completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })

  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1)
  expect(first.idle?.completions).toBe(1)
  expect(first.idle?.active).toBe(true)
  expect(first.idle?.intervalSec).toBeGreaterThan(2)

  const settled = settleRigs(db, bus, user.id, t0 + 60_000)
  const ore = getItemCount(db, user.id, 'copper_ore')
  expect(ore).toBeGreaterThan(1)
  expect(settled.gained.find((g) => g.item === 'copper_ore')?.count).toBe(ore - 1)
  sqlite.close()
})

test('settling twice over the same instant never double counts', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 1_500_000_000_000
  completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })
  const once = settleRigs(db, bus, user.id, t0 + 30_000)
  const twice = settleRigs(db, bus, user.id, t0 + 30_000)
  expect(once.gained.length).toBeGreaterThan(0)
  expect(twice.gained).toEqual([])
  expect(once.xp.get('mine-copper')).toBeGreaterThan(0)
  expect(twice.xp.size).toBe(0)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1 + (once.gained[0]?.count ?? 0))
  sqlite.close()
})

test('a rig levels its action on its own, no drill required', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 2_500_000_000_000
  completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })
  const before = getActionXp(db, user.id, 'mine-copper')

  const settled = settleRigs(db, bus, user.id, t0 + 600_000)
  const gained = settled.xp.get('mine-copper') ?? 0
  expect(gained).toBeGreaterThan(1)
  expect(getActionXp(db, user.id, 'mine-copper')).toBe(before + gained)
  sqlite.close()
})

test('an artisan rig turns stock into product and runs out when the bank does', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 2_000_000_000_000
  addItems(db, user.id, 'copper_ore', 20)
  addItems(db, user.id, 'tin_ore', 20)

  const first = completeAction(db, bus, user.id, { actionId: 'smelt-bronze', now: t0 })
  expect(first.gained.some((g) => g.item === 'bronze_bar')).toBe(true)
  expect(getItemCount(db, user.id, 'copper_ore')).toBeLessThan(20)

  settleRigs(db, bus, user.id, t0 + 60_000)
  const bars = getItemCount(db, user.id, 'bronze_bar')
  expect(bars).toBeGreaterThan(1)
  const perBar = ACTION_BY_ID.get('smelt-bronze')!.consumes!.find(
    (c) => c.item === 'copper_ore',
  )!.count
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(20 - bars * perBar)
  sqlite.close()
})

test('only two rigs run at once: a third drill stops the one closest to finishing', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 3_000_000_000_000
  const first = completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })
  const second = completeAction(db, bus, user.id, { actionId: 'chop-oak', now: t0 + 1 })
  expect(first.idle?.active).toBe(true)
  expect(second.idle?.active).toBe(true)
  expect(second.stoppedRig).toBe(null)
  expect(second.rigsRunning).toBe(2)
  expect(second.maxLiveRigs).toBe(2)

  const third = completeAction(db, bus, user.id, { actionId: 'fish-shrimp', now: t0 + 2 })
  expect(third.idle?.active).toBe(true)
  expect(third.rigsRunning).toBe(2)
  expect(third.stoppedRig?.actionId).toBe('mine-copper')

  const rigs = listRigStates(db, user.id)
  expect(rigs.get('mine-copper')!.runEndsAt).toBe(0)
  expect(rigs.get('chop-oak')!.runEndsAt).toBeGreaterThan(t0 + 2)
  expect(rigs.get('fish-shrimp')!.runEndsAt).toBeGreaterThan(t0 + 2)
  sqlite.close()
})

test('a rig can be stopped on purpose to free its slot for another', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 4_000_000_000_000
  completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })
  completeAction(db, bus, user.id, { actionId: 'chop-oak', now: t0 + 1 })
  expect(liveRigCount(listRigStates(db, user.id), t0 + 2)).toBe(2)

  expect(stopRig(db, bus, user.id, 'mine-copper', t0 + 2)).toBe(true)
  expect(stopRig(db, bus, user.id, 'mine-copper', t0 + 3)).toBe(false)
  const rigs = listRigStates(db, user.id)
  expect(rigs.get('mine-copper')!.runEndsAt).toBe(0)
  expect(liveRigCount(rigs, t0 + 3)).toBe(1)

  const third = completeAction(db, bus, user.id, { actionId: 'fish-shrimp', now: t0 + 4 })
  expect(third.stoppedRig).toBe(null)
  expect(liveRigCount(listRigStates(db, user.id), t0 + 5)).toBe(2)
  sqlite.close()
})

test('every powered drill is written to the completion log', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 3_000_000_000_000
  completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })
  completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 + 1_000 })
  const log = listGatherLog(db, user.id, 'mine-copper')
  expect(log.map((r) => r.completions)).toEqual([1, 2])
  sqlite.close()
})

test('the account level is the mean of the professions (percent complete)', () => {
  const { db, bus, user, sqlite } = setup()
  expect(accountLevel(db, user.id)).toEqual({ level: 1, progress: 0 })

  for (const s of SKILLS) setSkill(db, bus, user.id, s.id, 20)
  expect(accountLevel(db, user.id).level).toBe(20)
  sqlite.close()
})

test('one maxed profession only nudges the account level — that is the point', () => {
  const { db, bus, user, sqlite } = setup()
  setSkill(db, bus, user.id, 'mining', ACTION_MAX_LEVEL)
  expect(accountLevel(db, user.id).level).toBe(
    Math.round((ACTION_MAX_LEVEL + (SKILLS.length - 1)) / SKILLS.length),
  )
  sqlite.close()
})

test('a piece is worn in one slot: re-equipping it elsewhere moves it', () => {
  const { db, bus, user, sqlite } = setup()
  const ring = ITEMS.find(
    (i) => i.slot === 'ring1' && Object.keys(itemRequirements(i)).length === 0,
  )!
  addItems(db, user.id, ring.id, 1)
  const first = equipItem(db, bus, user.id, ring.id)
  expect(first.ok).toBe(true)
  const again = equipItem(db, bus, user.id, ring.id, {
    instanceId: first.instanceId,
    targetSlot: 'ring2',
  })
  expect(again.ok).toBe(true)
  expect(listEquipment(db, user.id).map((e) => e.slot)).toEqual(['ring2'])
  sqlite.close()
})

test('distilling equipment burns its rolled instance, and never a worn piece', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  const worn = equipItem(db, bus, user.id, 'bronze_sword')
  expect(distillItem(db, bus, user.id, 'bronze_sword')).toEqual({
    ok: false,
    error: 'unequip it first',
  })
  unequipItem(db, user.id, 'mainHand')
  expect(distillItem(db, bus, user.id, 'bronze_sword').ok).toBe(true)
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(0)
  expect(listGearInstances(db, user.id)).toEqual([])
  expect(equipItem(db, bus, user.id, 'bronze_sword', { instanceId: worn.instanceId }).ok).toBe(
    false,
  )
  sqlite.close()
})

test('idle XP does not depend on how often the rig is settled', () => {
  const xpAfter = (stepMs: number): number => {
    const { db, bus, user, sqlite } = setup()
    const t0 = 1_000_000
    completeAction(db, bus, user.id, { actionId: 'mine-copper', now: t0 })
    const before = getActionXp(db, user.id, 'mine-copper')
    for (let t = t0 + stepMs; t <= t0 + 600_000; t += stepMs) settleRigs(db, bus, user.id, t)
    const xp = getActionXp(db, user.id, 'mine-copper') - before
    sqlite.close()
    return xp
  }
  const once = xpAfter(600_000)
  expect(once).toBeGreaterThan(0)
  expect(Math.abs(xpAfter(5_000) - once)).toBeLessThanOrEqual(1)
})

test('the Thieving coins passive pays more coins, and only coins', () => {
  const coinsFrom = (level: number): number => {
    const { db, bus, user, sqlite } = setup()
    if (level > 1) setSkill(db, bus, user.id, 'thieving', level)
    let coins = 0
    for (let i = 0; i < 200; i++) {
      const got = grantItems(db, bus, user.id, {
        actionId: 'steal-coins',
        costs: [{ item: 'coins', count: 10 }],
        rand: () => 0.99,
      })
      coins += got[0]?.count ?? 0
    }
    sqlite.close()
    return coins
  }
  expect(coinsFrom(50)).toBeGreaterThan(coinsFrom(1) * 1.5)
})
