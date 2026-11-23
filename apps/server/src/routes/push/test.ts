/**
 * The push test button and the active-rig readout (docs/DESIGN.md §13.5.1).
 */

import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deletePushSubscription, listActiveRigs, listPushSubscriptions } from '../../db/repo'
import { ACTION_BY_ID } from '../../game/skills'
import { rigRunSec } from '../../game/idle'
import { RIG_ALERT_LEAD_SEC } from '../../push/notify'
import { sendPush } from '../../push/webpush'

export function registerPushTest(app: App) {
  // A settings-page button: proves the whole path works before a rig matters.
  app.post('/api/push/test', (c) => testHandler(c))
  // The active rigs and the lead time, for the client's local timer. Pure read:
  // settling happens on the next board fetch, so this is cheap to poll.
  app.get('/api/rigs', (c) => rigsHandler(c))
}

async function testHandler(c: Context<AppEnv>) {
  const user = c.get('user')!
  const db = c.get('deps').db
  const subs = listPushSubscriptions(db, user.id)
  if (!subs.length) return c.json({ error: 'no subscription on this device' }, 400)
  let sent = 0
  for (const sub of subs) {
    const res = await sendPush(db, sub, {
      title: 'Rig alerts are on',
      body: 'You will get a nudge when a rig has 30 minutes left.',
      url: '/home',
      tag: 'rigs-test',
      // The settings page is focused while testing; show it anyway.
      force: true,
    })
    if (res.ok) sent++
    else if (res.gone) deletePushSubscription(db, sub.userId, sub.endpoint)
  }
  if (!sent) return c.json({ error: 'the push service rejected the notification' }, 502)
  return c.json({ ok: true, sent })
}

function rigsHandler(c: Context<AppEnv>) {
  const user = c.get('user')!
  const now = Date.now()
  const rigs = listActiveRigs(c.get('deps').db, user.id, now).map((r) => rigView(r, now))
  return c.json({ leadSec: RIG_ALERT_LEAD_SEC, rigs })
}

function rigView(r: { actionId: string; runEndsAt: number; completions: number }, now: number) {
  return {
    actionId: r.actionId,
    name: ACTION_BY_ID.get(r.actionId)?.name ?? r.actionId,
    runEndsAt: r.runEndsAt,
    runSec: Math.round(rigRunSec(r.completions)),
    secondsLeft: Math.max(0, Math.round((r.runEndsAt - now) / 1000)),
  }
}
