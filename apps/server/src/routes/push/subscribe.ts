/**
 * Web Push plumbing (docs/DESIGN.md §13.5.1): the VAPID key, per-device
 * subscribe/unsubscribe, a test notification, and the rig clock the client's
 * local timer reads.
 */

import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deletePushSubscription, upsertPushSubscription } from '../../db/repo'
import { jsonBody, obj, str } from '../body'
import { vapidKeys } from '../../push/webpush'
import { fail } from '../errors'

interface SubscribeBody {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

/** Reads a browser push subscription's endpoint and its two keys. */
function readSubscribe(body: Record<string, unknown>): SubscribeBody {
  const keys = obj(body, 'keys')
  return {
    endpoint: str(body, 'endpoint'),
    keys: keys ? { p256dh: str(keys, 'p256dh'), auth: str(keys, 'auth') } : undefined,
  }
}

export function registerPushSubscribe(app: App) {
  app.get('/api/push/key', (c) => keyHandler(c))
  app.post('/api/push/subscribe', (c) => subscribeHandler(c))
  app.post('/api/push/unsubscribe', (c) => unsubscribeHandler(c))
}

/** The VAPID public key the browser subscribes with. Stable per database. */
async function keyHandler(c: Context<AppEnv>) {
  const keys = await vapidKeys(c.get('deps').db)
  return c.json({ publicKey: keys.publicKey })
}

async function subscribeHandler(c: Context<AppEnv>) {
  const user = c.get('user')!
  const body = readSubscribe(await jsonBody(c))
  const endpoint = body.endpoint?.trim()
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) return fail(c, 400, 'invalid subscription')
  if (!isPushServiceEndpoint(endpoint)) {
    return fail(c, 400, 'endpoint is not a known push service')
  }
  const sub = { userId: user.id, endpoint, p256dh, auth, userAgent: c.req.header('user-agent') }
  upsertPushSubscription(c.get('deps').db, sub)
  return c.json({ ok: true })
}

/**
 * The browser push services. The server POSTs to whatever endpoint it stores,
 * so anything else would let a member aim those requests at an arbitrary host
 * (an internal one included).
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  '.push.apple.com',
  'updates.push.services.mozilla.com',
  '.notify.windows.com',
]

/** True for an https endpoint on one of the known browser push services. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h))
}

async function unsubscribeHandler(c: Context<AppEnv>) {
  const endpoint = str(await jsonBody(c), 'endpoint')
  if (!endpoint) return fail(c, 400, 'endpoint required')
  deletePushSubscription(c.get('deps').db, c.get('user')!.id, endpoint)
  return c.json({ ok: true })
}
