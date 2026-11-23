import { afterEach, beforeEach, expect, test } from 'bun:test'
import { api, ApiError, onUnauthorized } from './api'
import { clearCache, peekCached } from './cache'

interface Call {
  url: string
  method: string
  reply: (body: unknown, status?: number) => void
}

let calls: Call[] = []
const realFetch = globalThis.fetch

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const reply = (body: unknown, status = 200) =>
      resolve(Response.json(body as object, { status }))
    calls.push({ url: String(input), method: init?.method ?? 'GET', reply })
  })
}

beforeEach(() => {
  calls = []
  clearCache()
  globalThis.fetch = fakeFetch as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  onUnauthorized(null)
})

const settle = () => new Promise((r) => setTimeout(r, 0))

test('concurrent GETs of one path share a single request', async () => {
  const a = api<{ n: number }>('/api/t/shared')
  const b = api<{ n: number }>('/api/t/shared')
  expect(calls.length).toBe(1)
  calls[0]!.reply({ n: 1 })
  expect(await a).toEqual({ n: 1 })
  expect(await b).toEqual({ n: 1 })
})

test('a GET after a mutation never joins the GET that started before it', async () => {
  const stale = api<{ n: number }>('/api/t/board')
  const write = api('/api/t/board', { method: 'POST' })
  calls[1]!.reply({ ok: true })
  await write
  const fresh = api<{ n: number }>('/api/t/board')
  expect(calls.length).toBe(3)
  calls[2]!.reply({ n: 2 })
  expect(await fresh).toEqual({ n: 2 })
  calls[0]!.reply({ n: 1 })
  expect(await stale).toEqual({ n: 1 })
  expect(peekCached<{ n: number }>('/api/t/board')).toEqual({ n: 2 })
})

test('a GET started while a mutation is in flight is not joined afterwards', async () => {
  const write = api('/api/t/mid', { method: 'POST' })
  const during = api('/api/t/mid')
  calls[0]!.reply({ ok: true })
  await write
  const after = api('/api/t/mid')
  expect(calls.length).toBe(3)
  calls[1]!.reply({ n: 1 })
  calls[2]!.reply({ n: 2 })
  await Promise.all([during, after])
})

test('a 401 on a data route clears the cache and signs the member out', async () => {
  const seeded = api('/api/t/seed')
  calls[0]!.reply({ n: 1 })
  await seeded
  let signedOut = 0
  onUnauthorized(() => signedOut++)
  const p = api('/api/t/private')
  calls[1]!.reply({ error: 'unauthorized' }, 401)
  const err = await p.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).status).toBe(401)
  expect(signedOut).toBe(1)
  expect(peekCached('/api/t/seed')).toBeUndefined()
})

test('a 401 from an auth route (a wrong password) is left to its caller', async () => {
  let signedOut = 0
  onUnauthorized(() => signedOut++)
  const p = api('/api/auth/login', { method: 'POST', body: '{}' })
  calls[0]!.reply({ error: 'invalid username or password' }, 401)
  await p.catch(() => {})
  await settle()
  expect(signedOut).toBe(0)
})

test('other errors (403, 500) do not sign the member out', async () => {
  let signedOut = 0
  onUnauthorized(() => signedOut++)
  const p = api('/api/t/forbidden')
  calls[0]!.reply({ error: 'nope' }, 403)
  await p.catch(() => {})
  expect(signedOut).toBe(0)
})
