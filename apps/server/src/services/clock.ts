import type { UserId } from '../ids'
import { getUserSetting, setUserSetting } from '../db/repo'
import type { Db } from '../db/client'

const TZ_KEY = 'timezone'
const MIN_MS = 60_000
const DAY_MS = 86_400_000

export function tzOffsetMin(timeZone: string | undefined, ts: number): number {
  if (!timeZone) return 0
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, ...WALL_CLOCK }).formatToParts(ts)
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
    return Math.round((wall - Math.floor(ts / 1000) * 1000) / MIN_MS)
  } catch {
    return 0
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

export function dayOf(ts: number, offsetMin = 0): string {
  return new Date(ts + offsetMin * MIN_MS).toISOString().slice(0, 10)
}

export function startOfDay(ts: number, offsetMin = 0): number {
  const local = ts + offsetMin * MIN_MS
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - offsetMin * MIN_MS
}

export function userOffsetMin(db: Db, userId: UserId, ts: number = Date.now()): number {
  return tzOffsetMin(getUserSetting(db, userId, TZ_KEY) || undefined, ts)
}

export function userDay(db: Db, userId: UserId, ts: number = Date.now()): string {
  return dayOf(ts, userOffsetMin(db, userId, ts))
}

export function isTimeZone(timeZone: string): boolean {
  if (!timeZone) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export function setUserTimeZone(db: Db, userId: UserId, timeZone: string): void {
  setUserSetting(db, userId, TZ_KEY, timeZone)
}
