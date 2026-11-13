import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addItems, createUser, getEncounter, getItemCount, getSkillXp } from '../db/repo'
import { EventBus } from '../events'
import { MONSTER_BY_ID } from './combat'
import {
  combatResolve,
  equipItem,
  foodThreshold,
  getPlayerCombat,
  monsterState,
  startEncounter,
} from './service'

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  return { db, bus, user, sqlite }
}

test('monsters are gated by skill level and equipment', () => {
  const { db, user, sqlite } = setup()
  const dragon = monsterState(db, user.id, MONSTER_BY_ID.get('dragon')!)
  expect(dragon.unlocked).toBe(false)
  expect(dragon.missing.length).toBe(2)
  expect(dragon.equipMissing?.tag).toBe('bow')

  expect(monsterState(db, user.id, MONSTER_BY_ID.get('slime')!).unlocked).toBe(true)
  sqlite.close()
})

test('a fight: hits damage the monster, a kill grants drops + XP', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  equipItem(db, bus, user.id, 'bronze_sword')

  const pc = getPlayerCombat(db, user.id, 'attack')
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
  expect(kill.drops).toEqual([{ item: 'bones', count: 1 }])
  expect(getItemCount(db, user.id, 'bones')).toBeGreaterThanOrEqual(1)
  expect(getSkillXp(db, user.id, 'attack')).toBeGreaterThan(0)
  expect(getEncounter(db, user.id)).toBeUndefined()
  sqlite.close()
})

test('a potion is auto-drunk at the start of a fight', () => {
  const { db, bus, user, sqlite } = setup()
  addItems(db, user.id, 'attack_potion', 1)
  const start = startEncounter(db, bus, user.id, 'goblin')
  expect(start.ok).toBe(true)
  if (!start.ok) return
  expect(start.drank?.item).toBe('attack_potion')
  expect(getItemCount(db, user.id, 'attack_potion')).toBe(0) // consumed

  // +25% power: base 5 (no weapon, attack 1) → 6
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
  // base max HP 24 → +25% = 30
  expect(start.encounter.playerHp).toBe(30)
  sqlite.close()
})

test('food is auto-eaten when HP drops below the threshold', () => {
  const { db, bus, user, sqlite } = setup()
  expect(foodThreshold(db, user.id)).toBe(0.5)
  addItems(db, user.id, 'cooked_shrimp', 3)
  startEncounter(db, bus, user.id, 'slime') // damage 2, maxHp 24

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

test('starting a locked monster is refused; no encounter returns null', () => {
  const { db, bus, user, sqlite } = setup()
  const res = startEncounter(db, bus, user.id, 'dragon')
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toBe('locked')
  expect(combatResolve(db, bus, user.id, true)).toBeNull()
  sqlite.close()
})
