/**
 * Sign-in throttling: after too many wrong passwords for one username, further
 * attempts are refused for a while. In memory on purpose — it protects a small
 * household server from a guessing script, and a restart clearing it is fine.
 */

const MAX_FAILURES = 8
const WINDOW_MS = 10 * 60_000

/** username (lower-cased) -> the times of its recent failures */
const failures = new Map<string, number[]>()

const keyOf = (username: string): string => username.trim().toLowerCase()

function recent(username: string, now: number): number[] {
  return (failures.get(keyOf(username)) ?? []).filter((t) => now - t < WINDOW_MS)
}

/** Seconds until this username may try again, or 0 when it may try now. */
export function retryAfterSec(username: string, now: number = Date.now()): number {
  const times = recent(username, now)
  if (times.length < MAX_FAILURES) return 0
  return Math.ceil((times[0]! + WINDOW_MS - now) / 1000)
}

export function noteFailure(username: string, now: number = Date.now()): void {
  failures.set(keyOf(username), [...recent(username, now), now])
}

export function clearFailures(username: string): void {
  failures.delete(keyOf(username))
}
