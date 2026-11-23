import { toUserId } from './ids'
import { expect, test } from 'bun:test'
import { openDb } from './db/client'
import { getSetting, setSetting } from './db/repo'
import { atomic, inTransaction } from './db/repo/helpers'
import { EventBus, type GameEventMap } from './events'

test('subscribe, emit and unsubscribe', () => {
  const bus = new EventBus()
  const seen: GameEventMap['xp.awarded'][] = []
  const off = bus.on('xp.awarded', (e) => seen.push(e))
  bus.emit('xp.awarded', { userId: toUserId('u'), amount: 10, reason: 'review', total: 10 })
  expect(seen.length).toBe(1)
  expect(seen[0]!.total).toBe(10)
  off()
  bus.emit('xp.awarded', { userId: toUserId('u'), amount: 5, reason: 'review', total: 15 })
  expect(seen.length).toBe(1)
})

test('a failing handler does not break others', () => {
  const bus = new EventBus()
  let reached = false
  bus.on('level.up', () => {
    throw new Error('boom')
  })
  bus.on('level.up', () => {
    reached = true
  })
  bus.emit('level.up', { userId: toUserId('u'), level: 2 })
  expect(reached).toBe(true)
  expect(bus.handlerCount('level.up')).toBe(2)
})

/** A bus that logs each `level.up` it delivers, on a fresh in-memory database. */
function txFixture() {
  const { db, sqlite } = openDb(':memory:')
  const bus = new EventBus()
  const seen: number[] = []
  bus.on('level.up', (e) => seen.push(e.level))
  const levelUp = (level: number) => bus.emit('level.up', { userId: toUserId('u'), level })
  return { db, sqlite, bus, seen, levelUp }
}

test('outside a transaction emit is immediate', () => {
  const { sqlite, seen, levelUp } = txFixture()
  levelUp(1)
  expect(seen).toEqual([1])
  sqlite.close()
})

test('an event emitted inside a transaction is delivered after commit, not before', () => {
  const { db, sqlite, seen, levelUp } = txFixture()
  const out = inTransaction(db, (tx) => {
    setSetting(tx, 'k', 'v')
    levelUp(2)
    expect(seen).toEqual([])
    return 'done'
  })
  expect(out).toBe('done')
  expect(getSetting(db, 'k')).toBe('v')
  expect(seen).toEqual([2])
  sqlite.close()
})

test('the write is already committed when the handler runs', () => {
  const { db, sqlite, bus, levelUp } = txFixture()
  let visible: string | undefined
  bus.on('level.up', () => {
    visible = getSetting(db, 'k')
  })
  inTransaction(db, (tx) => {
    setSetting(tx, 'k', 'v')
    levelUp(2)
  })
  expect(visible).toBe('v')
  sqlite.close()
})

test('nothing is delivered when the transaction throws', () => {
  const { db, sqlite, seen, levelUp } = txFixture()
  const run = () =>
    inTransaction(db, (tx) => {
      setSetting(tx, 'k', 'v')
      levelUp(3)
      throw new Error('rollback')
    })
  expect(run).toThrow('rollback')
  expect(getSetting(db, 'k')).toBeUndefined()
  expect(seen).toEqual([])
  // the buffer is gone with the transaction: the next emit is immediate again
  levelUp(4)
  expect(seen).toEqual([4])
  sqlite.close()
})

test('nested transactions flush once, in order, at the outermost commit', () => {
  const { db, sqlite, seen, levelUp } = txFixture()
  const nested = atomic((tx, level: number) => levelUp(level))
  inTransaction(db, (tx) => {
    levelUp(1)
    nested(tx, 2)
    expect(seen).toEqual([])
    inTransaction(tx, (inner) => nested(inner, 3))
    levelUp(4)
    expect(seen).toEqual([])
  })
  expect(seen).toEqual([1, 2, 3, 4])
  sqlite.close()
})

test('a rolled-back savepoint drops only its own events', () => {
  const { db, sqlite, seen, levelUp } = txFixture()
  inTransaction(db, (tx) => {
    levelUp(1)
    const inner = () =>
      inTransaction(tx, () => {
        levelUp(2)
        throw new Error('inner')
      })
    expect(inner).toThrow('inner')
    levelUp(3)
  })
  expect(seen).toEqual([1, 3])
  sqlite.close()
})

test('a handler that throws after commit does not break the transaction caller', () => {
  const { db, sqlite, bus, seen, levelUp } = txFixture()
  bus.on('level.up', () => {
    throw new Error('boom')
  })
  expect(inTransaction(db, () => (levelUp(5), 'ok'))).toBe('ok')
  expect(seen).toEqual([5])
  sqlite.close()
})
