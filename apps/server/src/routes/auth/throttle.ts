const MAX_FAILURES = 8
const WINDOW_MS = 10 * 60_000

const failures = new Map<string, number[]>()

const keyOf = (username: string): string => username.trim().toLowerCase()

function recent(username: string, now: number): number[] {
  return (failures.get(keyOf(username)) ?? []).filter((t) => now - t < WINDOW_MS)
}

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
