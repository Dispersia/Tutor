import { expect, test } from 'bun:test'
import { createApp } from '../app'
import type { Deps } from '../context'
import { openDb } from '../db/client'
import { EventBus } from '../events'
import { OpenRouter } from '../llm/openrouter'
import { SpeechSupervisor } from '../speech/supervisor'
import { guardError, NO_KEY_MESSAGE } from './errors'

const defaults = { conversation: 'c', judge: 'j', generator: 'g', translator: 't' }

async function makeApp() {
  const { db, sqlite } = openDb(':memory:')
  const supervisor = new SpeechSupervisor({
    url: 'http://127.0.0.1:1',
    port: 1,
    pythonDir: '.',
    modelsDir: '.',
    idleTimeoutMs: 600_000,
    autostart: false,
  })
  const deps: Deps = {
    db,
    or: new OpenRouter(undefined, 'http://127.0.0.1:1'),
    supervisor,
    defaults,
    serverKey: undefined,
    secret: undefined,
    allowRegistration: true,
    sessionTtlMs: 86_400_000,
    events: new EventBus(),
  }
  const app = createApp(deps, { staticDir: '/nope', log: false })
  const res = await app.request(
    '/api/auth/register',
    post({ username: 'al', password: 'password123' }),
  )
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const send = (path: string, body: unknown) =>
    app.request(path, { ...post(body), headers: { 'content-type': 'application/json', cookie } })
  return { sqlite, send }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('guardError builds the routes’ error body', () => {
  expect(guardError(409, 'missing materials', { missing: ['ore'] })).toEqual({
    status: 409,
    body: { error: 'missing materials', missing: ['ore'] },
  })
})

test('a use case that needs an OpenRouter key answers 409, not a bad gateway', async () => {
  const { sqlite, send } = await makeApp()
  const res = await send('/api/decks', { instruction: 'spanish frequency list', targetLang: 'es' })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: NO_KEY_MESSAGE })
  sqlite.close()
})

test('stopping a rig is idempotent: one that already ran out answers the fresh board', async () => {
  const { sqlite, send } = await makeApp()
  const res = await send('/api/skills/rigs/stop', { actionId: 'mine-copper' })
  expect(res.status).toBe(200)
  expect(Object.keys((await res.json()) as object)).toContain('rigs')
  const bad = await send('/api/skills/rigs/stop', {})
  expect(bad.status).toBe(400)
  sqlite.close()
})
