import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addXpEvent, createUser, xpByDay } from '../db/repo'
import { dayOf, isTimeZone, setUserTimeZone, startOfDay, tzOffsetMin, userDay } from './clock'

const TS = Date.UTC(2026, 0, 15, 1, 30)

test('a zone’s offset comes from the IANA name; an unknown zone is UTC', () => {
  expect(tzOffsetMin('America/Phoenix', TS)).toBe(-420)
  expect(tzOffsetMin('Asia/Taipei', TS)).toBe(480)
  expect(tzOffsetMin(undefined, TS)).toBe(0)
  expect(tzOffsetMin('Not/AZone', TS)).toBe(0)
  expect(isTimeZone('America/Phoenix')).toBe(true)
  expect(isTimeZone('Not/AZone')).toBe(false)
})

test('a day starts at the member’s own midnight', () => {
  expect(dayOf(TS)).toBe('2026-01-15')
  expect(dayOf(TS, -420)).toBe('2026-01-14')
  expect(startOfDay(TS, -420)).toBe(Date.UTC(2026, 0, 14, 7, 0))
  expect(startOfDay(TS)).toBe(Date.UTC(2026, 0, 15))
})

test('the stored zone decides which day an XP event belongs to', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'a', passwordHash: 'x' })
  expect(userDay(db, user.id, TS)).toBe('2026-01-15')
  setUserTimeZone(db, user.id, 'America/Phoenix')
  expect(userDay(db, user.id, TS)).toBe('2026-01-14')

  addXpEvent(db, user.id, 10, 'review')
  sqlite.run('update xp_events set created_at = ?', [TS])
  expect(xpByDay(db, user.id).map((r) => r.day)).toEqual(['2026-01-15'])
  expect(xpByDay(db, user.id, -420).map((r) => r.day)).toEqual(['2026-01-14'])
  sqlite.close()
})
