/**
 * Rig alerts on this device (docs/DESIGN.md §13.5.1).
 *
 * Two paths, one switch. The server pushes when a rig's run crosses the lead
 * time, which works with the app closed. While the app is open, this module
 * keeps a timer for the same moment so the alert still lands if the server
 * cannot reach the device — and the service worker skips the server copy when
 * a window is focused. The switch is per device: turning it on for the phone
 * leaves the laptop quiet.
 */

import { api } from './api'
import { base } from './paths'
import { disablePush, enablePush, pushPermission, syncPush } from './push'

const ENABLED_KEY = 'tutor.rigAlerts'
const SEEN_KEY = 'tutor.rigAlerts.seen'
const EVENT = 'tutor:rig-alerts'
const ICON = `${base}/icons/icon-192.png`

/** One active rig as `/api/rigs` reports it. */
export interface RigClock {
  actionId: string
  name: string
  runEndsAt: number
  runSec: number
  secondsLeft: number
}

export function alertsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function setEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // private mode: the in-memory switch still works for this page
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Remembers which run deadline was already announced, so reloads stay quiet. */
function seen(key: string): boolean {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return false
    const map = JSON.parse(raw) as Record<string, number>
    const stamp = map[key]
    if (!stamp) return false
    if (Date.now() - stamp > 2 * 24 * 3600 * 1000) {
      delete map[key]
      localStorage.setItem(SEEN_KEY, JSON.stringify(map))
      return false
    }
    return true
  } catch {
    return false
  }
}

function markSeen(key: string): void {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    map[key] = Date.now()
    localStorage.setItem(SEEN_KEY, JSON.stringify(map))
  } catch {
    // ignore: a reload may repeat the alert, which is better than losing it
  }
}

/** Arms one timer per rig that will cross the lead time while the page is open. */
export function scheduleRigAlerts(rigs: RigClock[], leadSec: number): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []
  const now = Date.now()
  for (const rig of rigs) {
    // A run shorter than the lead time never "runs low" — it was just powered.
    if (rig.runSec <= leadSec) continue
    const fireAt = rig.runEndsAt - leadSec * 1000
    // Already under the line when we looked: the server owns that deadline.
    if (fireAt <= now) continue
    const key = `${rig.actionId}:${rig.runEndsAt}`
    if (seen(key)) continue
    timers.push(
      setTimeout(() => {
        void announce(rig, key)
      }, fireAt - now),
    )
  }
  return () => {
    for (const t of timers) clearTimeout(t)
  }
}

async function announce(rig: RigClock, key: string): Promise<void> {
  if (!alertsEnabled() || pushPermission() !== 'granted') return
  // Only the focused window shows the page timer; the server push covers the
  // rest (a background tab would otherwise double-notify).
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  markSeen(key)
  const minutes = Math.max(1, Math.round((rig.runEndsAt - Date.now()) / 60_000))
  await show({
    title: `${rig.name} is running low`,
    body: `${minutes} minutes left — drill to keep it going.`,
    tag: `rigs-${rig.actionId}`,
    url: '/home',
  })
}

async function show(n: { title: string; body: string; tag: string; url: string }): Promise<void> {
  const reg = await navigator.serviceWorker?.ready.catch(() => null)
  if (reg) {
    await reg
      .showNotification(n.title, {
        body: n.body,
        tag: n.tag,
        icon: ICON,
        badge: ICON,
        data: { url: n.url },
      })
      .catch(() => {})
    return
  }
  // No worker (older browser): a page-level notification still works.
  try {
    new Notification(n.title, { body: n.body, tag: n.tag, icon: ICON })
  } catch {
    // Android has no Notification constructor; the worker path covers it.
  }
}

/**
 * Starts the open-app timer. Safe to call once from the app layout: it checks
 * the per-device switch on every tick, so turning alerts on or off takes effect
 * without a reload. Returns a stop function.
 */
export function startRigAlerts(): () => void {
  let stopped = false
  let cancel: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const refresh = async () => {
    if (stopped) return
    if (!alertsEnabled() || pushPermission() !== 'granted') {
      cancel?.()
      cancel = null
      return
    }
    try {
      const { leadSec, rigs } = await api<{ leadSec: number; rigs: RigClock[] }>('/api/rigs')
      cancel?.()
      cancel = scheduleRigAlerts(rigs, leadSec)
    } catch {
      // offline or logged out: the next tick tries again
    }
  }

  void syncPush()
  void refresh()
  timer = setInterval(() => void refresh(), 60_000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refresh()
  }
  const onToggle = () => void refresh()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener(EVENT, onToggle)

  return () => {
    stopped = true
    cancel?.()
    if (timer) clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener(EVENT, onToggle)
  }
}

/** Turns alerts on for this device: permission, subscription, then the timer. */
export async function enableRigAlerts(): Promise<{ ok: boolean; error?: string }> {
  const res = await enablePush()
  if (!res.ok) return res
  setEnabled(true)
  return { ok: true }
}

/** Turns alerts off for this device and forgets the subscription. */
export async function disableRigAlerts(): Promise<void> {
  setEnabled(false)
  await disablePush().catch(() => {})
}

/** Sends a notification through the server so the whole path is proven. */
export async function testRigAlert(): Promise<void> {
  await api('/api/push/test', { method: 'POST' })
}
