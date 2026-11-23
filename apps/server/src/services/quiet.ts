import type { UserId } from '../ids'
import { getUserSetting, setUserSetting } from '../db/repo'

export const QUIET_MS = 15 * 60_000

const KEY = 'quietUntil'

export interface QuietState {
  active: boolean
  until: number
}

export function quietState(
  db: Parameters<typeof getUserSetting>[0],
  userId: UserId,
  now = Date.now(),
): QuietState {
  const raw = getUserSetting(db, userId, KEY)
  const until = raw ? Number(raw) : 0
  const active = Number.isFinite(until) && until > now
  return { active, until: active ? until : 0 }
}

export function setQuiet(
  db: Parameters<typeof getUserSetting>[0],
  userId: UserId,
  active: boolean,
  now = Date.now(),
): QuietState {
  setUserSetting(db, userId, KEY, active ? String(now + QUIET_MS) : '0')
  return quietState(db, userId, now)
}
