/**
 * Tells the server which time zone this browser is in, so the streak and the
 * daily goal roll over at the member's own midnight rather than at UTC's.
 */
import { api } from './api'

const KEY = 'tutor.timezone.'

/** The browser's IANA zone (`Europe/Paris`), or '' when it cannot say. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}

function lastSent(userId: string): string {
  try {
    return localStorage.getItem(KEY + userId) ?? ''
  } catch {
    return ''
  }
}

function remember(userId: string, zone: string): void {
  try {
    localStorage.setItem(KEY + userId, zone)
  } catch {
    // Private mode or a full quota: it is simply sent again next session.
  }
}

/**
 * Reports the zone when it differs from the last one sent for this member (a
 * new device, or a trip). Best effort: a failure is retried on the next open.
 */
export async function reportTimezone(userId: string | undefined): Promise<void> {
  const zone = browserTimezone()
  if (!userId || !zone || zone === lastSent(userId)) return
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ timezone: zone }) })
    remember(userId, zone)
  } catch {
    // offline or rejected: nothing to show, the server keeps its last value
  }
}
