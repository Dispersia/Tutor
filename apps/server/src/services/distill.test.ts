import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addItems, createUser, getActionXp, getItemCount } from '../db/repo'
import { EventBus } from '../events'
import {
  completeAction,
  equipItem,
  getDistillConfig,
  setDistillMode,
  settleRigs,
  toggleDistillItem,
} from '.'

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  return { db, bus, user, sqlite }
}

test('the distill allowlist and mode persist per member', () => {
  const { db, user, sqlite } = setup()
  expect(getDistillConfig(db, user.id)).toEqual({ mode: 'max-value', allow: [] })

  setDistillMode(db, user.id, 'min-value')
  toggleDistillItem(db, user.id, 'copper_ore')
  toggleDistillItem(db, user.id, 'bronze_sword')
  expect(getDistillConfig(db, user.id).mode).toBe('min-value')
  expect(getDistillConfig(db, user.id).allow.sort()).toEqual(['bronze_sword', 'copper_ore'])

  toggleDistillItem(db, user.id, 'copper_ore')
  expect(getDistillConfig(db, user.id).allow).toEqual(['bronze_sword'])
  sqlite.close()
})

test('the distill rig burns only marked items, highest value first', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 1_000_000_000_000
  setDistillMode(db, user.id, 'max-value')
  toggleDistillItem(db, user.id, 'copper_ore')
  toggleDistillItem(db, user.id, 'bronze_sword')
  addItems(db, user.id, 'copper_ore', 2)
  addItems(db, user.id, 'bronze_sword', 1)
  addItems(db, user.id, 'iron_ore', 3)

  completeAction(db, bus, user.id, { actionId: 'distill', now: t0 })
  const before = getActionXp(db, user.id, 'distill')
  settleRigs(db, bus, user.id, t0 + 300_000)

  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(0)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(0)
  expect(getItemCount(db, user.id, 'iron_ore')).toBe(3)
  expect(getItemCount(db, user.id, 'metal_essence')).toBe(3)
  expect(getActionXp(db, user.id, 'distill') - before).toBe(6)
  sqlite.close()
})

test('lowest-value-first burns the cheap stock before the sword', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 2_000_000_000_000
  setDistillMode(db, user.id, 'min-value')
  toggleDistillItem(db, user.id, 'copper_ore')
  toggleDistillItem(db, user.id, 'bronze_sword')
  addItems(db, user.id, 'copper_ore', 2)
  addItems(db, user.id, 'bronze_sword', 1)

  completeAction(db, bus, user.id, { actionId: 'distill', now: t0 })
  settleRigs(db, bus, user.id, t0 + 30_000)

  expect(getItemCount(db, user.id, 'copper_ore')).toBe(1)
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)
  sqlite.close()
})

test('an empty allowlist never burns anything', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 3_000_000_000_000
  addItems(db, user.id, 'copper_ore', 5)
  completeAction(db, bus, user.id, { actionId: 'distill', now: t0 })
  const before = getActionXp(db, user.id, 'distill')
  settleRigs(db, bus, user.id, t0 + 600_000)
  expect(getItemCount(db, user.id, 'copper_ore')).toBe(5)
  expect(getActionXp(db, user.id, 'distill')).toBe(before)
  sqlite.close()
})

test('a worn piece is never distilled, even as the last copy', () => {
  const { db, bus, user, sqlite } = setup()
  const t0 = 4_000_000_000_000
  setDistillMode(db, user.id, 'max-value')
  toggleDistillItem(db, user.id, 'bronze_sword')
  addItems(db, user.id, 'bronze_sword', 1)
  expect(equipItem(db, bus, user.id, 'bronze_sword').ok).toBe(true)
  completeAction(db, bus, user.id, { actionId: 'distill', now: t0 })
  const before = getActionXp(db, user.id, 'distill')
  settleRigs(db, bus, user.id, t0 + 600_000)
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)
  expect(getActionXp(db, user.id, 'distill')).toBe(before)
  sqlite.close()
})
