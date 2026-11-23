/**
 * Web Push client plumbing (docs/DESIGN.md §13.5.1). The server owns the VAPID
 * key and the subscription table; this module only asks the browser for a
 * subscription and hands it over. Every device opts in on its own.
 */

import { api } from './api'

export type PushPermission = 'unsupported' | 'denied' | 'default' | 'granted'

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function pushPermission(): PushPermission {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

/** Base64url → the Uint8Array `applicationServerKey` expects. */
function decodeKey(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : ''
  const raw = atob(padded + pad)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** The subscription this device already has, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  return reg ? reg.pushManager.getSubscription() : null
}

/**
 * Asks for permission and subscribes. Must be called from a user gesture: the
 * browser only shows the permission prompt on a click.
 */
export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'This browser cannot show notifications.' }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'Notifications are blocked in the browser settings.' }
  }
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  if (!reg) return { ok: false, error: 'The app is not ready yet. Reload and try again.' }
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key')
  const sub = await ensureSubscription(reg, decodeKey(publicKey))
  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub.toJSON()),
  })
  return { ok: true }
}

/** The device's subscription under the server's current VAPID key. */
async function ensureSubscription(
  reg: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription> {
  const sub = await reg.pushManager.getSubscription()
  // A subscription minted under an older VAPID key cannot be reused: the server
  // would sign with a key the push service no longer trusts.
  if (sub && sameKey(sub.options.applicationServerKey, key)) return sub
  if (sub) await sub.unsubscribe().catch(() => {})
  return subscribeNew(reg, key)
}

async function subscribeNew(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>) {
  return reg.pushManager
    .subscribe({ userVisibleOnly: true, applicationServerKey: key })
    .catch(async () => {
      // Some browsers keep a stale subscription around; drop it and retry once.
      const stale = await reg.pushManager.getSubscription()
      if (stale) await stale.unsubscribe().catch(() => {})
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    })
}

/** Compares the subscription's key with the server's current key. */
function sameKey(stored: ArrayBuffer | ArrayBufferView | null, wanted: Uint8Array): boolean {
  if (!stored) return false
  const a =
    stored instanceof ArrayBuffer
      ? new Uint8Array(stored)
      : new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength)
  if (a.length !== wanted.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== wanted[i]) return false
  return true
}

/** Removes the subscription from this device and from the server. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api('/api/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/**
 * Re-sends the existing subscription to the server. Cheap and idempotent: it
 * heals a rotated endpoint or a rebuilt database without a fresh permission.
 */
export async function syncPush(): Promise<void> {
  if (pushPermission() !== 'granted') return
  const sub = await currentSubscription()
  if (!sub) return
  const key = await api<{ publicKey: string }>('/api/push/key').catch(() => null)
  if (!key) return
  // A rebuilt server mints a new VAPID key; the old subscription must be replaced.
  if (!sameKey(sub.options.applicationServerKey, decodeKey(key.publicKey))) {
    await enablePush().catch(() => {})
    return
  }
  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub.toJSON()),
  }).catch(() => {})
}
