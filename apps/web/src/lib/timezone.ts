import { api } from './api'

const KEY = 'tutor.timezone.'

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
  } catch {}
}

export async function reportTimezone(userId: string | undefined): Promise<void> {
  const zone = browserTimezone()
  if (!userId || !zone || zone === lastSent(userId)) return
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ timezone: zone }) })
    remember(userId, zone)
  } catch {}
}
