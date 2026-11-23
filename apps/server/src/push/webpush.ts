import type { Db } from '../db/client'
import { getSetting, setSetting } from '../db/repo'
import { env } from '../env'

const VAPID_SETTING = 'push.vapid'
const JWT_TTL_SEC = 12 * 60 * 60
const RECORD_SIZE = 4096
const PUSH_TIMEOUT_MS = 10_000
const GONE_STATUSES = new Set([401, 403, 404, 410])

export interface VapidKeys {
  publicKey: string
  privateKey: CryptoKey
}

export interface PushSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushResult {
  ok: boolean
  gone: boolean
  status?: number
  error?: string
}

const cache = new WeakMap<Db, Promise<VapidKeys>>()

export function vapidKeys(db: Db): Promise<VapidKeys> {
  let keys = cache.get(db)
  if (!keys) {
    keys = loadOrCreate(db).catch((e: unknown) => {
      cache.delete(db)
      throw e
    })
    cache.set(db, keys)
  }
  return keys
}

async function loadOrCreate(db: Db): Promise<VapidKeys> {
  const raw = getSetting(db, VAPID_SETTING)
  if (raw) {
    try {
      const saved = JSON.parse(raw) as { pub: string; d: string }
      if (saved.pub && saved.d) {
        return { publicKey: saved.pub, privateKey: await importPrivate(saved.pub, saved.d) }
      }
    } catch {}
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])
  const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  setSetting(db, VAPID_SETTING, JSON.stringify({ pub, d: jwk.d }))
  return { publicKey: pub, privateKey: pair.privateKey }
}

async function importPrivate(pub: string, d: string): Promise<CryptoKey> {
  const raw = unb64u(pub)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64u(raw.slice(1, 33)),
    y: b64u(raw.slice(33, 65)),
    d,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
}

interface SendOpts {
  subject?: string
  ttlSec?: number
  fetchImpl?: typeof fetch
}

export async function sendPush(
  db: Db,
  sub: PushSubscription,
  payload: unknown,
  opts: SendOpts = {},
): Promise<PushResult> {
  const audience = endpointOrigin(sub.endpoint)
  if (!audience) return { ok: false, gone: true, error: 'invalid endpoint' }
  try {
    const keys = await vapidKeys(db)
    const jwt = await vapidJwt(keys, audience, opts.subject ?? env.pushSubject)
    const res = await post(sub, keys, jwt, await encryptPayload(sub, payload), opts)
    return res instanceof Error ? { ok: false, gone: false, error: String(res) } : resultOf(res)
  } catch (e) {
    return { ok: false, gone: false, error: String(e) }
  }
}

function endpointOrigin(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).origin
  } catch {
    return undefined
  }
}

function post(
  sub: PushSubscription,
  keys: VapidKeys,
  jwt: string,
  body: Uint8Array<ArrayBuffer>,
  opts: SendOpts,
) {
  return (opts.fetchImpl ?? fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt},k=${keys.publicKey}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(opts.ttlSec ?? 6 * 60 * 60),
      urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  }).catch((e: unknown) => e as Error)
}

async function resultOf(res: Response): Promise<PushResult> {
  const status = res.status
  if (GONE_STATUSES.has(status)) return { ok: false, gone: true, status }
  if (res.ok) return { ok: true, gone: false, status }
  const text = await res.text().catch(() => '')
  return { ok: false, gone: false, status, error: text.slice(0, 200) }
}

async function vapidJwt(keys: VapidKeys, audience: string, subject: string): Promise<string> {
  const header = b64u(encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(
    encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + JWT_TTL_SEC,
        sub: subject,
      }),
    ),
  )
  const input = `${header}.${claims}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    encode(input),
  )
  return `${input}.${b64u(new Uint8Array(sig))}`
}

async function encryptPayload(
  sub: PushSubscription,
  payload: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPub = unb64u(sub.p256dh)
  const auth = unb64u(sub.auth)
  const { localPub, secret } = await ecdhSecret(uaPub)
  const prk = await hkdf(auth, secret, concat(encode('WebPush: info\0'), uaPub, localPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, prk, encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, prk, encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(encode(JSON.stringify(payload)), new Uint8Array([2]))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, plain),
  )
  return concat(salt, u32be(RECORD_SIZE), new Uint8Array([localPub.length]), localPub, cipher)
}

async function ecdhSecret(uaPub: Uint8Array<ArrayBuffer>) {
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256),
  )
  return { localPub, secret }
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

function encode(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
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

function u32be(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
}

function b64u(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64u(text: string): Uint8Array<ArrayBuffer> {
  const t = text.replace(/-/g, '+').replace(/_/g, '/')
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : ''
  const bin = atob(t + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
