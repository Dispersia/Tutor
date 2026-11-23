import type { App } from '../context'
import {
  deletePushSubscription,
  listActiveRigs,
  listPushSubscriptions,
  upsertPushSubscription,
} from '../db/repo'
import { ACTION_BY_ID } from '../game/skills'
import { rigRunSec } from '../game/idle'
import { RIG_ALERT_LEAD_SEC } from '../push/notify'
import { sendPush, vapidKeys } from '../push/webpush'

/**
 * Web Push plumbing (docs/DESIGN.md §13.5.1) and the rig clock the client's
 * local timer reads. Everything here is per device: each installed PWA opts in
 * on its own, so a laptop stays quiet unless its owner turned alerts on there.
 */
export function registerPush(app: App) {
  // The VAPID public key the browser subscribes with. Stable per database.
  app.get('/api/push/key', async (c) => {
    const keys = await vapidKeys(c.get('deps').db)
    return c.json({ publicKey: keys.publicKey })
  })

  app.post('/api/push/subscribe', async (c) => {
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    const endpoint = body.endpoint?.trim()
    const p256dh = body.keys?.p256dh
    const auth = body.keys?.auth
    if (!endpoint || !p256dh || !auth) return c.json({ error: 'invalid subscription' }, 400)
    try {
      const url = new URL(endpoint)
      if (url.protocol !== 'https:') return c.json({ error: 'endpoint must be https' }, 400)
    } catch {
      return c.json({ error: 'invalid endpoint' }, 400)
    }
    upsertPushSubscription(c.get('deps').db, {
      userId: user.id,
      endpoint,
      p256dh,
      auth,
      userAgent: c.req.header('user-agent'),
    })
    return c.json({ ok: true })
  })

  app.post('/api/push/unsubscribe', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string }
    if (!body.endpoint) return c.json({ error: 'endpoint required' }, 400)
    deletePushSubscription(c.get('deps').db, body.endpoint)
    return c.json({ ok: true })
  })

  // A settings-page button: proves the whole path works before a rig matters.
  app.post('/api/push/test', async (c) => {
    const user = c.get('user')!
    const subs = listPushSubscriptions(c.get('deps').db, user.id)
    if (!subs.length) return c.json({ error: 'no subscription on this device' }, 400)
    let sent = 0
    for (const sub of subs) {
      const res = await sendPush(c.get('deps').db, sub, {
        title: 'Rig alerts are on',
        body: 'You will get a nudge when a rig has 30 minutes left.',
        url: '/home',
        tag: 'rigs-test',
        // The settings page is focused while testing; show it anyway.
        force: true,
      })
      if (res.ok) sent++
      else if (res.gone) deletePushSubscription(c.get('deps').db, sub.endpoint)
    }
    if (!sent) return c.json({ error: 'the push service rejected the notification' }, 502)
    return c.json({ ok: true, sent })
  })

  // The active rigs and the lead time, for the client's local timer. Pure read:
  // settling happens on the next board fetch, so this is cheap to poll.
  app.get('/api/rigs', (c) => {
    const user = c.get('user')!
    const now = Date.now()
    const rigs = listActiveRigs(c.get('deps').db, user.id, now).map((r) => ({
      actionId: r.actionId,
      name: ACTION_BY_ID.get(r.actionId)?.name ?? r.actionId,
      runEndsAt: r.runEndsAt,
      runSec: Math.round(rigRunSec(r.completions)),
      secondsLeft: Math.max(0, Math.round((r.runEndsAt - now) / 1000)),
    }))
    return c.json({ leadSec: RIG_ALERT_LEAD_SEC, rigs })
  })
}
