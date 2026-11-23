import type { UserId } from '../ids'
import { expect, test } from 'bun:test'
import type { Db } from '../db/client'
import { openDb } from '../db/client'
import { createUser, upsertPushSubscription } from '../db/repo'
import { actionProgress } from '../db/schema'
import { RIG_ALERT_LEAD_SEC, runRigAlerts } from './notify'
import { sendPush, vapidKeys } from './webpush'

const enc = new TextEncoder()
const b64u = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const unb64u = (text: string): string => {
  const t = text.replace(/-/g, '+').replace(/_/g, '/')
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : ''
  return atob(t + pad)
}

async function receiver() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { pair, raw, auth, p256dh: b64u(raw), authKey: b64u(auth) }
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  len: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    len * 8,
  )
  return new Uint8Array(bits)
}

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

test('VAPID keys are stable per database and stored once', async () => {
  const { db, sqlite } = openDb(':memory:')
  const a = await vapidKeys(db)
  const b = await vapidKeys(db)
  expect(a.publicKey).toBe(b.publicKey)
  expect(a.publicKey).toHaveLength(87)
  expect(sqlite.query('select key from settings').all()).toEqual([{ key: 'push.vapid' }])
})

test('sendPush encrypts an RFC 8291 payload the browser can read', async () => {
  const { db } = openDb(':memory:')
  const sub = await receiver()
  let sent: { url: string; init: RequestInit } | undefined
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent = { url, init }
    return new Response(null, { status: 201 })
  }) as unknown as typeof fetch

  const res = await sendPush(
    db,
    { endpoint: 'https://push.example/abc', p256dh: sub.p256dh, auth: sub.authKey },
    { title: 'Mine copper is running low', body: '20 minutes left' },
    { fetchImpl, subject: 'mailto:test@example.com' },
  )
  expect(res).toEqual({ ok: true, gone: false, status: 201 })

  const headers = new Headers(sent!.init.headers)
  expect(headers.get('content-encoding')).toBe('aes128gcm')
  expect(headers.get('ttl')).toBe('21600')
  const auth = headers.get('authorization')!
  expect(auth.startsWith('vapid ')).toBe(true)
  const jwt = auth.slice('vapid '.length).split(',')[0]!.replace(/^t=/, '')
  const [head, claims, sig] = jwt.split('.')
  expect(JSON.parse(unb64u(head!))).toEqual({ alg: 'ES256', typ: 'JWT' })
  expect(JSON.parse(unb64u(claims!)).aud).toBe('https://push.example')
  expect(sig!.length).toBe(86)

  const body = new Uint8Array(sent!.init.body as unknown as Uint8Array)
  const salt = body.slice(0, 16)
  const idLen = body[20]!
  const asPublic = body.slice(21, 21 + idLen)
  const ciphertext = body.slice(21 + idLen)
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.pair.privateKey, 256),
  )
  const prk = await hkdf(
    sub.auth,
    shared,
    concat(enc.encode('WebPush: info\0'), sub.raw, asPublic),
    32,
  )
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext),
  )
  expect(plain.at(-1)).toBe(2)
  expect(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))).toEqual({
    title: 'Mine copper is running low',
    body: '20 minutes left',
  })
})

test('sendPush reports a dead subscription', async () => {
  const { db } = openDb(':memory:')
  const sub = await receiver()
  const fetchImpl = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch
  const res = await sendPush(
    db,
    { endpoint: 'https://push.example/gone', p256dh: sub.p256dh, auth: sub.authKey },
    { title: 'x' },
    { fetchImpl },
  )
  expect(res).toEqual({ ok: false, gone: true, status: 410 })
})

function rig(
  db: Db,
  userId: UserId,
  runEndsAt: number,
  completions = 50,
  actionId = 'mine-copper',
) {
  db.insert(actionProgress)
    .values({
      userId,
      actionId,
      completions,
      runEndsAt,
      settledAt: runEndsAt,
      updatedAt: runEndsAt,
    })
    .run()
}

function stubSend() {
  const calls: { payload: unknown; endpoint: string }[] = []
  const send = (async (_db: Db, sub: { endpoint: string }, payload: unknown) => {
    calls.push({ payload, endpoint: sub.endpoint })
    return { ok: true, gone: false }
  }) as unknown as typeof sendPush
  return { calls, send }
}

test('announces a long rig once when it crosses the lead time', async () => {
  const { db } = openDb(':memory:')
  const user = createUser(db, { username: 'alice' })
  const now = Date.now()
  rig(db, user.id, now + 20 * 60_000)
  upsertPushSubscription(db, {
    userId: user.id,
    endpoint: 'https://push.example/a',
    p256dh: 'p',
    auth: 'a',
  })
  const { calls, send } = stubSend()

  expect(await runRigAlerts({ db, send, now })).toEqual({ users: 1, rigs: 1 })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.payload).toMatchObject({ title: 'Mine copper is running low' })

  expect(await runRigAlerts({ db, send, now })).toEqual({ users: 0, rigs: 0 })
  expect(calls).toHaveLength(1)
})

test('re-arms when a drill extends the run', async () => {
  const { db } = openDb(':memory:')
  const user = createUser(db, { username: 'alice' })
  const now = Date.now()
  rig(db, user.id, now + 20 * 60_000)
  upsertPushSubscription(db, {
    userId: user.id,
    endpoint: 'https://push.example/a',
    p256dh: 'p',
    auth: 'a',
  })
  const { calls, send } = stubSend()
  await runRigAlerts({ db, send, now })

  const extended = now + 25 * 60_000
  db.update(actionProgress).set({ runEndsAt: extended }).run()
  expect(await runRigAlerts({ db, send, now })).toEqual({ users: 1, rigs: 1 })
  expect(calls).toHaveLength(2)
})

test('ignores short runs and runs outside the lead window', async () => {
  const { db } = openDb(':memory:')
  const user = createUser(db, { username: 'alice' })
  const now = Date.now()
  rig(db, user.id, now + 5 * 60_000, 0, 'mine-copper')
  rig(db, user.id, now + 40 * 60_000, 50, 'mine-tin')
  upsertPushSubscription(db, {
    userId: user.id,
    endpoint: 'https://push.example/a',
    p256dh: 'p',
    auth: 'a',
  })
  const { calls, send } = stubSend()
  expect(await runRigAlerts({ db, send, now })).toEqual({ users: 0, rigs: 0 })
  expect(calls).toHaveLength(0)
})

test('drops a dead subscription and leaves the deadline unannounced', async () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice' })
  const now = Date.now()
  rig(db, user.id, now + 20 * 60_000)
  upsertPushSubscription(db, {
    userId: user.id,
    endpoint: 'https://push.example/gone',
    p256dh: 'p',
    auth: 'a',
  })
  const send = (async () => ({ ok: false, gone: true })) as unknown as typeof sendPush
  expect(await runRigAlerts({ db, send, now })).toEqual({ users: 0, rigs: 0 })
  expect(sqlite.query('select count(*) as n from push_subscriptions').get()).toEqual({ n: 0 })
  const row = sqlite.query('select notified_ends_at as n from action_progress').get() as {
    n: number
  }
  expect(row.n).toBe(0)
})

test('lead time is half an hour', () => {
  expect(RIG_ALERT_LEAD_SEC).toBe(1800)
})

test('sendPush prunes on 401/403 and bounds the request with a timeout', async () => {
  const { db } = openDb(':memory:')
  const sub = await receiver()
  const target = { endpoint: 'https://push.example/x', p256dh: sub.p256dh, auth: sub.authKey }
  for (const status of [401, 403]) {
    let signal: AbortSignal | null | undefined
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      signal = init.signal
      return new Response('nope', { status })
    }) as unknown as typeof fetch
    expect(await sendPush(db, target, { title: 'x' }, { fetchImpl })).toEqual({
      ok: false,
      gone: true,
      status,
    })
    expect(signal).toBeInstanceOf(AbortSignal)
  }
  const flaky = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch
  expect((await sendPush(db, target, { title: 'x' }, { fetchImpl: flaky })).gone).toBe(false)
})

test('a device has one owner: the newest member to enable it takes it over', () => {
  const { db, sqlite } = openDb(':memory:')
  const alice = createUser(db, { username: 'alice' })
  const bob = createUser(db, { username: 'bob' })
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
  upsertPushSubscription(db, { userId: alice.id, endpoint, p256dh: 'p', auth: 'a' })
  upsertPushSubscription(db, { userId: bob.id, endpoint, p256dh: 'p2', auth: 'a2' })
  expect(sqlite.query('select user_id as u, p256dh as k from push_subscriptions').all()).toEqual([
    { u: bob.id, k: 'p2' },
  ])
  sqlite.close()
})
