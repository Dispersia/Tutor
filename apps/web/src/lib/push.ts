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

function decodeKey(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : ''
  const raw = atob(padded + pad)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  return reg ? reg.pushManager.getSubscription() : null
}

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

async function ensureSubscription(
  reg: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription> {
  const sub = await reg.pushManager.getSubscription()
  if (sub && sameKey(sub.options.applicationServerKey, key)) return sub
  if (sub) await sub.unsubscribe().catch(() => {})
  return subscribeNew(reg, key)
}

async function subscribeNew(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>) {
  return reg.pushManager
    .subscribe({ userVisibleOnly: true, applicationServerKey: key })
    .catch(async () => {
      const stale = await reg.pushManager.getSubscription()
      if (stale) await stale.unsubscribe().catch(() => {})
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    })
}

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

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api('/api/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

export async function syncPush(): Promise<void> {
  if (pushPermission() !== 'granted') return
  const sub = await currentSubscription()
  if (!sub) return
  const key = await api<{ publicKey: string }>('/api/push/key').catch(() => null)
  if (!key) return
  if (!sameKey(sub.options.applicationServerKey, decodeKey(key.publicKey))) {
    await enablePush().catch(() => {})
    return
  }
  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub.toJSON()),
  }).catch(() => {})
}
