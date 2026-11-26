import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deletePushSubscription, listActiveRigs, listPushSubscriptions } from '../../db/repo'
import { ACTION_BY_ID } from '../../game/skills'
import { rigRunSec } from '../../game/idle'
import { RIG_ALERT_LEAD_SEC, RIG_ALERT_MIN_RUN_SEC } from '../../push/notify'
import { sendPush } from '../../push/webpush'
import { fail } from '../errors'

export function registerPushTest(app: App) {
  app.post('/api/push/test', (c) => testHandler(c))
  app.get('/api/rigs', (c) => rigsHandler(c))
}

async function testHandler(c: Context<AppEnv>) {
  const user = c.get('user')!
  const db = c.get('deps').db
  const subs = listPushSubscriptions(db, user.id)
  if (!subs.length) return fail(c, 400, 'no subscription on this device')
  let sent = 0
  for (const sub of subs) {
    const res = await sendPush(db, sub, {
      title: 'Rig alerts are on',
      body: 'You will get a nudge when a long rig has 30 minutes left.',
      url: '/home',
      tag: 'rigs-test',
      force: true,
    })
    if (res.ok) sent++
    else if (res.gone) deletePushSubscription(db, sub.userId, sub.endpoint)
  }
  if (!sent) return fail(c, 502, 'the push service rejected the notification')
  return c.json({ ok: true, sent })
}

function rigsHandler(c: Context<AppEnv>) {
  const user = c.get('user')!
  const now = Date.now()
  const rigs = listActiveRigs(c.get('deps').db, user.id, now).map((r) => rigView(r, now))
  return c.json({ leadSec: RIG_ALERT_LEAD_SEC, minRunSec: RIG_ALERT_MIN_RUN_SEC, rigs })
}

function rigView(
  r: { actionId: string; runEndsAt: number; runStartedAt: number; completions: number },
  now: number,
) {
  return {
    actionId: r.actionId,
    name: ACTION_BY_ID.get(r.actionId)?.name ?? r.actionId,
    runEndsAt: r.runEndsAt,
    runStartedAt: r.runStartedAt,
    runSec: Math.round(rigRunSec(r.completions)),
    secondsLeft: Math.max(0, Math.round((r.runEndsAt - now) / 1000)),
  }
}
