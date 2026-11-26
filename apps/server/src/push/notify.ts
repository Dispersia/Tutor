import type { UserId } from '../ids'
import type { Db } from '../db/client'
import {
  deletePushSubscription,
  dueRigAlerts,
  listPushSubscriptions,
  markRigAlerted,
  touchPushSubscription,
  type DueRigRow,
  type PushSubscriptionRow,
} from '../db/repo'
import { ACTION_BY_ID } from '../game/skills'
import { rigRunSec } from '../game/idle'
import { sendPush } from './webpush'

export const RIG_ALERT_LEAD_SEC = 30 * 60
export const RIG_ALERT_MIN_RUN_SEC = 60 * 60
const TICK_MS = 60_000
const TTL_SEC = RIG_ALERT_LEAD_SEC

export interface RigAlertDeps {
  db: Db
  send?: typeof sendPush
  now?: number
}

export interface RigAlertResult {
  users: number
  rigs: number
}

export async function runRigAlerts(deps: RigAlertDeps): Promise<RigAlertResult> {
  const now = deps.now ?? Date.now()
  const send = deps.send ?? sendPush
  let users = 0
  let rigs = 0
  for (const [userId, rows] of dueByUser(deps.db, now)) {
    const sent = await notifyUser(deps, send, { userId, rows, now })
    if (!sent) continue
    users++
    rigs += rows.length
  }
  return { users, rigs }
}

function dueByUser(db: Db, now: number): Map<UserId, DueRigRow[]> {
  const byUser = new Map<UserId, DueRigRow[]>()
  for (const row of dueRigAlerts(db, now, RIG_ALERT_LEAD_SEC * 1000)) {
    if (rigRunLengthSec(row) <= RIG_ALERT_MIN_RUN_SEC) continue
    const list = byUser.get(row.userId)
    if (list) list.push(row)
    else byUser.set(row.userId, [row])
  }
  return byUser
}

export function rigRunLengthSec(row: {
  completions: number
  runEndsAt: number
  runStartedAt: number
}): number {
  const startedAt =
    row.runStartedAt > 0 ? row.runStartedAt : row.runEndsAt - rigRunSec(row.completions) * 1000
  return (row.runEndsAt - startedAt) / 1000
}

interface UserAlert {
  userId: UserId
  rows: DueRigRow[]
  now: number
}

async function notifyUser(
  deps: RigAlertDeps,
  send: typeof sendPush,
  req: UserAlert,
): Promise<boolean> {
  const subs = listPushSubscriptions(deps.db, req.userId)
  if (!subs.length) return false
  const delivered = await deliver(deps, send, subs, alertPayload(req.rows, req.now))
  if (!delivered) return false
  for (const row of req.rows) markRigAlerted(deps.db, req.userId, row.actionId, row.runEndsAt)
  return true
}

async function deliver(
  deps: RigAlertDeps,
  send: typeof sendPush,
  subs: PushSubscriptionRow[],
  payload: ReturnType<typeof alertPayload>,
): Promise<boolean> {
  let delivered = false
  for (const sub of subs) {
    if (await pushOne(deps, send, sub, payload)) delivered = true
  }
  return delivered
}

async function pushOne(
  deps: RigAlertDeps,
  send: typeof sendPush,
  sub: PushSubscriptionRow,
  payload: ReturnType<typeof alertPayload>,
): Promise<boolean> {
  const res = await send(deps.db, sub, payload, { ttlSec: TTL_SEC }).catch(() => ({
    ok: false,
    gone: false,
  }))
  if (res.ok) {
    touchPushSubscription(deps.db, sub.endpoint)
    return true
  }
  if (res.gone) deletePushSubscription(deps.db, sub.userId, sub.endpoint)
  return false
}

function alertPayload(rows: { actionId: string; runEndsAt: number }[], now: number) {
  const names = rows.map((r) => ACTION_BY_ID.get(r.actionId)?.name ?? r.actionId)
  const minutes = Math.max(
    1,
    Math.round((Math.min(...rows.map((r) => r.runEndsAt)) - now) / 60_000),
  )
  const title =
    names.length === 1 ? `${names[0]} is running low` : `${names.length} rigs are running low`
  const body =
    names.length === 1
      ? `${names[0]} has ${minutes} minutes left — drill to keep it going.`
      : `${names.join(', ')} have under ${minutes} minutes left — drill to keep them going.`
  return { title, body, url: '/home', tag: 'rigs' }
}

export function startRigNotifier(deps: RigAlertDeps): () => void {
  let busy = false
  const tick = () => {
    if (busy) return
    busy = true
    void runRigAlerts(deps)
      .catch((e) => console.error('[push] rig alert scan failed:', e))
      .finally(() => {
        busy = false
      })
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  return () => clearInterval(timer)
}
