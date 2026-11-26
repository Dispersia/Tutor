import { api } from './api'
import { base } from './paths'
import { disablePush, enablePush, pushPermission, syncPush } from './push'
import { rigRunLengthSec } from './idle'
import { toast } from './toast.svelte'

const ENABLED_KEY = 'tutor.rigAlerts'
const SEEN_KEY = 'tutor.rigAlerts.seen'
const EVENT = 'tutor:rig-alerts'
const ICON = `${base}/icons/icon-192.png`

interface RigClock {
  actionId: string
  name: string
  runEndsAt: number
  runStartedAt: number
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
  } catch {}
  window.dispatchEvent(new Event(EVENT))
}

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
  } catch {}
}

function scheduleRigAlerts(rigs: RigClock[], leadSec: number, minRunSec: number): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []
  const now = Date.now()
  for (const rig of rigs) {
    const timer = armRig(rig, leadSec, minRunSec, now)
    if (timer) timers.push(timer)
  }
  return () => {
    for (const t of timers) clearTimeout(t)
  }
}

function armRig(
  rig: RigClock,
  leadSec: number,
  minRunSec: number,
  now: number,
): ReturnType<typeof setTimeout> | null {
  if (rigRunLengthSec(rig) <= minRunSec) return null
  const fireAt = rig.runEndsAt - leadSec * 1000
  if (fireAt <= now) return null
  const key = `${rig.actionId}:${rig.runEndsAt}`
  if (seen(key)) return null
  return setTimeout(() => {
    void announce(rig, key)
  }, fireAt - now)
}

async function announce(rig: RigClock, key: string): Promise<void> {
  if (!alertsEnabled() || pushPermission() !== 'granted') return
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  markSeen(key)
  const minutes = Math.max(1, Math.round((rig.runEndsAt - Date.now()) / 60_000))
  try {
    await show({
      title: `${rig.name} is running low`,
      body: `${minutes} minutes left — drill to keep it going.`,
      tag: `rigs-${rig.actionId}`,
      url: '/home',
    })
  } catch {
    toast('Could not show the rig reminder', 'error')
  }
}

async function show(n: { title: string; body: string; tag: string; url: string }): Promise<void> {
  const reg = await navigator.serviceWorker?.ready.catch(() => null)
  if (reg) {
    await reg.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      icon: ICON,
      badge: ICON,
      data: { url: n.url },
    })
    return
  }
  try {
    new Notification(n.title, { body: n.body, tag: n.tag, icon: ICON })
  } catch {}
}

export function startRigAlerts(): () => void {
  const state: RigAlertState = { stopped: false, cancel: null, timer: null, reported: false }
  const refresh = () => void refreshRigs(state)
  void syncPush()
  refresh()
  state.timer = setInterval(refresh, 60_000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener(EVENT, refresh)
  return () => stopRigAlerts(state, onVisible, refresh)
}

interface RigAlertState {
  stopped: boolean
  cancel: (() => void) | null
  timer: ReturnType<typeof setInterval> | null
  reported: boolean
}

interface RigsReply {
  leadSec: number
  minRunSec: number
  rigs: RigClock[]
}

async function refreshRigs(state: RigAlertState): Promise<void> {
  if (state.stopped) return
  if (!alertsEnabled() || pushPermission() !== 'granted') {
    state.cancel?.()
    state.cancel = null
    return
  }
  try {
    const reply = await api<RigsReply>('/api/rigs')
    if (state.stopped) return
    state.cancel?.()
    state.cancel = scheduleRigAlerts(reply.rigs, reply.leadSec, reply.minRunSec)
    state.reported = false
  } catch {
    reportPaused(state)
  }
}

function reportPaused(state: RigAlertState): void {
  if (state.reported) return
  state.reported = true
  toast('Rig reminders paused — could not reach the server', 'error')
}

function stopRigAlerts(state: RigAlertState, onVisible: () => void, refresh: () => void): void {
  state.stopped = true
  state.cancel?.()
  if (state.timer) clearInterval(state.timer)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener(EVENT, refresh)
}

export async function enableRigAlerts(): Promise<{ ok: boolean; error?: string }> {
  const res = await enablePush()
  if (!res.ok) return res
  setEnabled(true)
  return { ok: true }
}

export async function disableRigAlerts(): Promise<void> {
  setEnabled(false)
  await disablePush().catch(() => {})
}

export async function testRigAlert(): Promise<void> {
  await api('/api/push/test', { method: 'POST' })
}
