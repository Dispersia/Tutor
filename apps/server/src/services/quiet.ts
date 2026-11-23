import type { UserId } from '../ids'
import { getUserSetting, setUserSetting } from '../db/repo'

/**
 * "I can't speak or listen right now." A time-boxed option that hides the
 * listen/speak exercises for a while, so you can keep drilling quietly. It only
 * filters what is offered; XP for the cards you do complete is unaffected.
 */
export const QUIET_MS = 15 * 60_000

const KEY = 'quietUntil'

export interface QuietState {
  /** true while the option is on (and not yet expired) */
  active: boolean
  /** epoch ms when it lifts; 0 when off (or already expired) */
  until: number
}

/** Reads the current quiet window for a user (an expired window reads as off). */
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

/** Turns the option on for `QUIET_MS`, or off, returning the new state. */
export function setQuiet(
  db: Parameters<typeof getUserSetting>[0],
  userId: UserId,
  active: boolean,
  now = Date.now(),
): QuietState {
  setUserSetting(db, userId, KEY, active ? String(now + QUIET_MS) : '0')
  return quietState(db, userId, now)
}
