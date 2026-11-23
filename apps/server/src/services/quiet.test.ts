import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { createUser } from '../db/repo'
import { QUIET_MS, quietState, setQuiet } from './quiet'

test('quiet mode turns on for 15 minutes, then lifts', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  const now = 1_000_000

  expect(QUIET_MS).toBe(15 * 60_000)
  expect(quietState(db, user.id, now)).toEqual({ active: false, until: 0 })

  const on = setQuiet(db, user.id, true, now)
  expect(on.active).toBe(true)
  expect(on.until).toBe(now + QUIET_MS)

  // Still on just before it lifts; off exactly at expiry.
  expect(quietState(db, user.id, now + QUIET_MS - 1).active).toBe(true)
  expect(quietState(db, user.id, now + QUIET_MS)).toEqual({ active: false, until: 0 })

  // Can be turned off early.
  setQuiet(db, user.id, true, now)
  expect(setQuiet(db, user.id, false, now).active).toBe(false)
  sqlite.close()
})
