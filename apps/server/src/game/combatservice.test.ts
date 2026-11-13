import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addItems, createUser, getEncounter, getItemCount, getSkillXp } from '../db/repo'
import { EventBus } from '../events'
import { MONSTER_BY_ID } from './combat'
import { combatResolve, equipItem, getPlayerCombat, monsterState, startEncounter } from './service'

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  return { db, bus, user, sqlite }
}

test('monsters are gated by skill level and equipment', () => {
  const { db, user, sqlite } = setup()
  // dragon needs ranged 20 + defence 15 and a bow
  const dragon = monsterState(db, user.id, MONSTER_BY_ID.get('dragon')!)
  expect(dragon.unlocked).toBe(false)
  expect(dragon.missing.length).toBe(2)
  expect(dragon.equipMissing?.tag).toBe('bow')

  // a slime needs nothing
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

  const start = startEncounter(db, user.id, 'slime')
  expect(start.ok).toBe(true)
  if (!start.ok) return
  expect(start.encounter.monsterHp).toBe(12)
  expect(start.encounter.playerHp).toBe(pc.maxHp)

  const first = combatResolve(db, bus, user.id, true)!
  expect(first.damage).toBe(8)
  expect(first.monsterHp).toBe(4)
  expect(first.outcome).toBe('ongoing')
  expect(getEncounter(db, user.id)?.monsterHp).toBe(4)

  const kill = combatResolve(db, bus, user.id, true)!
  expect(kill.outcome).toBe('won')
  expect(kill.monsterHp).toBe(0)
  expect(kill.drops).toEqual([{ item: 'bones', count: 1 }])
  expect(getItemCount(db, user.id, 'bones')).toBeGreaterThanOrEqual(1)
  expect(getSkillXp(db, user.id, 'attack')).toBeGreaterThan(0)
  expect(getEncounter(db, user.id)).toBeUndefined() // encounter cleared
  sqlite.close()
})

test('missing a drill lets the monster hit you, and you can lose', () => {
  const { db, bus, user, sqlite } = setup()
  startEncounter(db, user.id, 'goblin')
  let outcome = 'ongoing'
  for (let i = 0; i < 60 && outcome === 'ongoing'; i++) {
    outcome = combatResolve(db, bus, user.id, false)!.outcome
  }
  expect(outcome).toBe('lost')
  expect(getEncounter(db, user.id)).toBeUndefined()
  sqlite.close()
})

test('starting a locked monster is refused', () => {
  const { db, user, sqlite } = setup()
  const res = startEncounter(db, user.id, 'dragon')
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toBe('locked')
  sqlite.close()
})

test('combatResolve returns null with no active encounter', () => {
  const { db, bus, user, sqlite } = setup()
  expect(combatResolve(db, bus, user.id, true)).toBeNull()
  sqlite.close()
})
