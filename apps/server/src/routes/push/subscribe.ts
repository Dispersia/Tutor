/**
 * Web Push plumbing (docs/DESIGN.md §13.5.1): the VAPID key, per-device
 * subscribe/unsubscribe, a test notification, and the rig clock the client's
 * local timer reads.
 */

import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deletePushSubscription, upsertPushSubscription } from '../../db/repo'
import { vapidKeys } from '../../push/webpush'

interface SubscribeBody {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
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
  const body = (await c.req.json().catch(() => ({}))) as SubscribeBody
  const endpoint = body.endpoint?.trim()
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) return c.json({ error: 'invalid subscription' }, 400)
  if (!isHttpsEndpoint(endpoint)) return c.json({ error: 'endpoint must be https' }, 400)
  upsertPushSubscription(c.get('deps').db, {
    userId: user.id,
    endpoint,
    p256dh,
    auth,
    userAgent: c.req.header('user-agent'),
  })
  return c.json({ ok: true })
}

function isHttpsEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === 'https:'
  } catch {
    return false
  }
}

async function unsubscribeHandler(c: Context<AppEnv>) {
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string }
  if (!body.endpoint) return c.json({ error: 'endpoint required' }, 400)
  deletePushSubscription(c.get('deps').db, body.endpoint)
  return c.json({ ok: true })
}
