import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import {
  addGearInstance,
  addItems,
  clearEncounter,
  createUser,
  getActionXp,
  getEncounter,
  getItemCount,
} from '../db/repo'
import { EventBus } from '../events'
import { MONSTER_BY_ID } from '../game/combat'
import {
  combatResolve,
  equipItem,
  foodThreshold,
  loadPlayerCombat,
  monsterState,
  startEncounter,
  unequipItem,
} from './index'

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  return { db, bus, user, sqlite }
}

test('every monster is fightable — no per-monster skill or gear gate', () => {
  const { db, user, sqlite } = setup()
  for (const m of MONSTER_BY_ID.values()) {
    const state = monsterState(db, user.id, m)
    expect(state.unlocked).toBe(true)
    expect(state.missing).toEqual([])
    expect(state.equipMissing).toBeNull()
  }
  sqlite.close()
})

test('a fight: hits damage the monster, a kill grants drops + XP', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  equipItem(db, bus, user.id, 'bronze_sword')

  const pc = loadPlayerCombat(db, user.id)
  expect(pc.skill).toBe('strength')
  expect(pc.power).toBe(8)
  expect(pc.weaponPower).toBe(3)

  const start = startEncounter(db, bus, user.id, 'slime')
  expect(start.ok).toBe(true)
  if (!start.ok) return
  expect(start.encounter.monsterHp).toBe(15)
  expect(start.encounter.playerHp).toBe(pc.maxHp)
  expect(start.drank).toBeNull()

  const first = combatResolve(db, bus, user.id, true)!
  expect(first.damage).toBe(8)
  expect(first.monsterHp).toBe(7)
  expect(first.outcome).toBe('ongoing')

  const kill = combatResolve(db, bus, user.id, true)!
  expect(kill.outcome).toBe('won')
  expect(kill.monsterHp).toBe(0)
  expect(kill.drops).toContainEqual({ item: 'bones', count: 1 })
  expect(getItemCount(db, user.id, 'bones')).toBeGreaterThanOrEqual(1)
  expect(getActionXp(db, user.id, 'train-strength')).toBeGreaterThan(0)
  expect(getEncounter(db, user.id)).toBeUndefined()
  sqlite.close()
})

test('the weapon decides the skill the fight trains', () => {
  const { db, bus, user, sqlite } = setup()
  expect(loadPlayerCombat(db, user.id).skill).toBe('strength')
  addItems(db, user.id, 'oak_shortbow', 1)
  equipItem(db, bus, user.id, 'oak_shortbow')
  expect(loadPlayerCombat(db, user.id).skill).toBe('ranged')
  unequipItem(db, user.id, 'weapon')
  addItems(db, user.id, 'oak_staff', 1)
  equipItem(db, bus, user.id, 'oak_staff')
  expect(loadPlayerCombat(db, user.id).skill).toBe('magic')
  sqlite.close()
})

test('taking a hit costs HP and trains nothing', () => {
  const { db, bus, user, sqlite } = setup()
  startEncounter(db, bus, user.id, 'slime')
  const hit = combatResolve(db, bus, user.id, false)!
  expect(hit.playerDamage).toBe(2)
  expect(hit.xp).toBe(0)
  expect(getActionXp(db, user.id, 'train-strength')).toBe(0)
  sqlite.close()
})

test('the monster hits you even when you strike it', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  equipItem(db, bus, user.id, 'bronze_sword')
  const pc = loadPlayerCombat(db, user.id)

  const start = startEncounter(db, bus, user.id, 'slime')
  expect(start.ok).toBe(true)
  if (!start.ok) return

  const hit = combatResolve(db, bus, user.id, true)!
  expect(hit.damage).toBe(8)
  expect(hit.monsterHp).toBe(7)
  expect(hit.playerDamage).toBe(2)
  expect(hit.playerHp).toBe(pc.maxHp - 2)
  sqlite.close()
})

test('HP persists between fights — restarting is not a free heal', () => {
  const { db, bus, user, sqlite } = setup()
  const pc = loadPlayerCombat(db, user.id)

  startEncounter(db, bus, user.id, 'slime')
  const first = combatResolve(db, bus, user.id, true)!
  expect(first.playerHp).toBe(pc.maxHp - 2)

  clearEncounter(db, user.id)
  const again = startEncounter(db, bus, user.id, 'slime')
  expect(again.ok).toBe(true)
  if (!again.ok) return
  expect(again.encounter.playerHp).toBe(pc.maxHp - 2)
  sqlite.close()
})

test('a defeat leaves you at a sliver of HP, not a full heal', () => {
  const { db, bus, user, sqlite } = setup()
  startEncounter(db, bus, user.id, 'goblin')
  let outcome = 'ongoing'
  for (let i = 0; i < 60 && outcome === 'ongoing'; i++) {
    outcome = combatResolve(db, bus, user.id, false)!.outcome
  }
  expect(outcome).toBe('lost')

  const again = startEncounter(db, bus, user.id, 'slime')
  expect(again.ok).toBe(true)
  if (!again.ok) return
  expect(again.encounter.playerHp).toBe(1)
  sqlite.close()
})

test('a potion is auto-drunk at the start of a fight', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'attack_potion', 1)
  const start = startEncounter(db, bus, user.id, 'goblin')
  expect(start.ok).toBe(true)
  if (!start.ok) return
  expect(start.drank?.item).toBe('attack_potion')
  expect(getItemCount(db, user.id, 'attack_potion')).toBe(0)

  const hit = combatResolve(db, bus, user.id, true)!
  expect(hit.damage).toBe(6)
  sqlite.close()
})

test('a restore potion raises max HP for the fight', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'restore_potion', 1)
  const start = startEncounter(db, bus, user.id, 'goblin')
  expect(start.ok).toBe(true)
  if (!start.ok) return
  expect(start.encounter.playerHp).toBe(25)
  sqlite.close()
})

test('food is auto-eaten when HP drops below the threshold', () => {
  const { db, bus, user, sqlite } = setup()
  expect(foodThreshold(db, user.id)).toBe(0.5)
  addItems(db, user.id, 'cooked_shrimp', 3)
  startEncounter(db, bus, user.id, 'slime')

  let ate = null
  for (let i = 0; i < 20 && !ate; i++) {
    ate = combatResolve(db, bus, user.id, false)!.ate
  }
  expect(ate?.item).toBe('cooked_shrimp')
  expect(ate?.heal).toBe(4)
  expect(getItemCount(db, user.id, 'cooked_shrimp')).toBe(2)
  sqlite.close()
})

test('without food you just take the damage', () => {
  const { db, bus, user, sqlite } = setup()
  startEncounter(db, bus, user.id, 'slime')
  const hit = combatResolve(db, bus, user.id, false)!
  expect(hit.ate).toBeNull()
  expect(hit.playerDamage).toBe(2)
  sqlite.close()
})

test('missing drills can lose the fight', () => {
  const { db, bus, user, sqlite } = setup()
  startEncounter(db, bus, user.id, 'goblin')
  let outcome = 'ongoing'
  for (let i = 0; i < 60 && outcome === 'ongoing'; i++) {
    outcome = combatResolve(db, bus, user.id, false)!.outcome
  }
  expect(outcome).toBe('lost')
  expect(getEncounter(db, user.id)).toBeUndefined()
  sqlite.close()
})

test('starting an unknown monster is refused; no encounter returns null', () => {
  const { db, bus, user, sqlite } = setup()
  const res = startEncounter(db, bus, user.id, 'mystery')
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toBe('unknown monster')
  expect(combatResolve(db, bus, user.id, true)).toBeNull()
  sqlite.close()
})

test('mastery scales a hit once: it is inside the power, not multiplied again', () => {
  const { db, bus, user, sqlite } = setup()
  const instanceId = addGearInstance(db, {
    userId: user.id,
    itemId: 'bronze_sword',
    slot: 'mainHand',
    quality: 'epic',
    statsJson: JSON.stringify({ mastery: 260 }),
    armour: 0,
    power: 3,
  })
  expect(equipItem(db, bus, user.id, 'bronze_sword', { instanceId }).ok).toBe(true)
  const pc = loadPlayerCombat(db, user.id)
  expect(pc.mastery).toBeCloseTo(0.5)
  expect(pc.power).toBeGreaterThan(8)

  startEncounter(db, bus, user.id, 'slime')
  const hit = combatResolve(db, bus, user.id, true, () => 0.99)!
  expect(hit.damage).toBe(pc.power)
  sqlite.close()
})

test('a monster killed by the strike does not swing back', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  equipItem(db, bus, user.id, 'bronze_sword')
  startEncounter(db, bus, user.id, 'slime')
  let hit = combatResolve(db, bus, user.id, true)!
  while (hit.outcome === 'ongoing') hit = combatResolve(db, bus, user.id, true)!
  expect(hit.outcome).toBe('won')
  expect(hit.playerDamage).toBe(0)
  sqlite.close()
})

test('a second fight cannot be started over a running one', () => {
  const { db, bus, user, sqlite } = setup()
  expect(startEncounter(db, bus, user.id, 'slime').ok).toBe(true)
  combatResolve(db, bus, user.id, true)
  const again = startEncounter(db, bus, user.id, 'slime')
  expect(again.ok).toBe(false)
  expect(getEncounter(db, user.id)!.monsterHp).toBeLessThan(15)
  sqlite.close()
})
