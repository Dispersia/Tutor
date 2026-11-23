/**
 * The member's calendar day (docs/DESIGN.md §13).
 *
 * Every timestamp is stored in UTC. What is personal is where a *day* begins:
 * the streak, the daily goal and the study budget all roll over at the member's
 * own midnight, not at UTC midnight (5 pm in Arizona). The browser reports its
 * IANA time zone once and it is kept in `user_settings`; with none stored a day
 * is a UTC day.
 */

import type { UserId } from '../ids'
import { getUserSetting, setUserSetting } from '../db/repo'
import type { Db } from '../db/client'

const TZ_KEY = 'timezone'
const MIN_MS = 60_000
const DAY_MS = 86_400_000

/** Minutes the zone is ahead of UTC at `ts` (negative west of Greenwich); 0 when unknown. */
export function tzOffsetMin(timeZone: string | undefined, ts: number): number {
  if (!timeZone) return 0
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, ...WALL_CLOCK }).formatToParts(ts)
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
    return Math.round((wall - Math.floor(ts / 1000) * 1000) / MIN_MS)
  } catch {
    return 0 // not a zone this runtime knows
  }
}

const WALL_CLOCK = {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
} as const

/** The calendar day (YYYY-MM-DD) that `ts` falls on, `offsetMin` ahead of UTC. */
export function dayOf(ts: number, offsetMin = 0): string {
  return new Date(ts + offsetMin * MIN_MS).toISOString().slice(0, 10)
}

/** Epoch ms of the midnight that began the day `ts` falls on, `offsetMin` ahead of UTC. */
export function startOfDay(ts: number, offsetMin = 0): number {
  const local = ts + offsetMin * MIN_MS
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - offsetMin * MIN_MS
}

/** The member's offset from UTC right now, from their stored time zone. */
export function userOffsetMin(db: Db, userId: UserId, ts: number = Date.now()): number {
  return tzOffsetMin(getUserSetting(db, userId, TZ_KEY) || undefined, ts)
}

/** The member's own calendar day at `ts`. */
export function userDay(db: Db, userId: UserId, ts: number = Date.now()): string {
  return dayOf(ts, userOffsetMin(db, userId, ts))
}

/** Whether this runtime knows the IANA zone ('' clears the setting, so it is allowed). */
export function isTimeZone(timeZone: string): boolean {
  if (!timeZone) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Stores the browser's time zone (validate with `isTimeZone` first). */
export function setUserTimeZone(db: Db, userId: UserId, timeZone: string): void {
  setUserSetting(db, userId, TZ_KEY, timeZone)
}
