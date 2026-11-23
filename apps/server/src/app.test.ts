import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import type { Role } from './env'
import { EventBus } from './events'
import { OpenRouter } from './llm/openrouter'
import { SpeechSupervisor } from './speech/supervisor'

const defaults: Record<Role, string> = {
  conversation: 'qwen/c',
  judge: 'qwen/j',
  generator: 'qwen/g',
  translator: 'qwen/t',
}

let stub: { url: string; stop: () => void }

beforeAll(() => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path.endsWith('/chat/completions')) {
        const enc = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const chunk of [
              'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
              'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,"cost":0.0001}}\n\n',
              'data: [DONE]\n\n',
            ]) {
              c.enqueue(enc.encode(chunk))
            }
            c.close()
          },
        })
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      }
      if (path.endsWith('/models/user')) {
        return Response.json({
          data: [
            {
              id: 'user/key-model',
              name: 'Key Model',
              context_length: 2000,
              pricing: {},
              architecture: { output_modalities: ['text'] },
            },
          ],
        })
      }
      if (path.endsWith('/models')) {
        return Response.json({
          data: [
            {
              id: 'qwen/test',
              name: 'Qwen Test',
              context_length: 1000,
              pricing: {},
              architecture: { output_modalities: ['text'] },
            },
          ],
        })
      }
      return new Response('nope', { status: 404 })
    },
  })
  stub = { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
})

afterAll(() => stub.stop())

function makeApp(allowRegistration = true, serverKey: string | null = 'test-key') {
  const { db, sqlite } = openDb(':memory:')
  const deps: Deps = {
    db,
    or: new OpenRouter(serverKey ?? undefined, stub.url),
    supervisor: new SpeechSupervisor({
      url: 'http://127.0.0.1:1',
      port: 1,
      pythonDir: '.',
      modelsDir: '.',
      idleTimeoutMs: 600_000,
      autostart: false,
    }),
    defaults,
    serverKey: serverKey ?? undefined,
    secret: undefined,
    allowRegistration,
    sessionTtlMs: 86_400_000,
    events: new EventBus(),
  }
  const app = createApp(deps, { staticDir: '/definitely/not/here', log: false })
  return { app, db, sqlite }
}

async function signup(app: App, username: string, password = 'password123') {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const body = (await res.json()) as { user: { id: string; role: string } }
  return { cookie, user: body.user }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('public endpoints need no session', async () => {
  const { app } = makeApp()
  const health = await app.request('/api/health')
  expect(health.status).toBe(200)
  expect(((await health.json()) as { openrouter: boolean }).openrouter).toBe(true)
  const models = await app.request('/api/models')
  expect(models.status).toBe(200)
})

test('model catalogue follows the key: /models/user when set, public otherwise', async () => {
  const ids = async (serverKey: string | null) => {
    const { app } = makeApp(true, serverKey)
    const body = (await (await app.request('/api/models')).json()) as {
      models: { id: string }[]
    }
    return body.models.map((m) => m.id)
  }
  // A key present (server or the user's own) → key-filtered catalogue.
  expect(await ids('test-key')).toContain('user/key-model')
  // No key anywhere → public catalogue, no key required.
  expect(await ids(null)).toContain('qwen/test')
  expect(await ids(null)).not.toContain('user/key-model')
})

test('protected endpoints reject anonymous requests', async () => {
  const { app } = makeApp()
  for (const path of ['/api/settings', '/api/sessions', '/api/chat']) {
    const res = await app.request(path, { method: path === '/api/chat' ? 'POST' : 'GET' })
    expect(res.status).toBe(401)
  }
})

test('first user becomes admin; auth/me works', async () => {
  const { app, db, sqlite } = makeApp()
  const { cookie, user } = await signup(app, 'dispe')
  expect(user.role).toBe('admin')
  const me = await app.request('/api/auth/me', { headers: { cookie } })
  expect(((await me.json()) as { user: { username: string } }).user.username).toBe('dispe')
  sqlite.close()
  void db
})

test('login + logout', async () => {
  const { app, sqlite } = makeApp()
  await signup(app, 'alice')
  const bad = await app.request('/api/auth/login', json({ username: 'alice', password: 'wrong' }))
  expect(bad.status).toBe(401)

  const ok = await app.request(
    '/api/auth/login',
    json({ username: 'alice', password: 'password123' }),
  )
  expect(ok.status).toBe(200)
  const cookie = ok.headers.getSetCookie()[0]!.split(';')[0]!
  expect((await app.request('/api/auth/me', { headers: { cookie } })).status).toBe(200)

  await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } })
  const after = await app.request('/api/auth/me', { headers: { cookie } })
  expect(((await after.json()) as { user: null }).user).toBeNull()
  sqlite.close()
})

test('chat streams SSE, persists per user, and isolates history', async () => {
  const { app, db, sqlite } = makeApp()
  const alice = await signup(app, 'alice')
  const bob = await signup(app, 'bob')

  const res = await app.request('/api/chat', {
    ...json({ text: '你好', role: 'conversation' }),
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
  })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).toContain('event: delta')
  expect(text).toContain('event: done')

  const aliceSessions = (await (
    await app.request('/api/sessions', { headers: { cookie: alice.cookie } })
  ).json()) as {
    sessions: { id: string }[]
  }
  expect(aliceSessions.sessions.length).toBe(1)

  const bobSessions = (await (
    await app.request('/api/sessions', { headers: { cookie: bob.cookie } })
  ).json()) as {
    sessions: { id: string }[]
  }
  expect(bobSessions.sessions.length).toBe(0)

  // bob cannot read alice's session
  const forbidden = await app.request(`/api/sessions/${aliceSessions.sessions[0]!.id}`, {
    headers: { cookie: bob.cookie },
  })
  expect(forbidden.status).toBe(404)
  sqlite.close()
  void db
})

test('per-user model selection', async () => {
  const { app } = makeApp()
  const alice = await signup(app, 'alice')
  const bob = await signup(app, 'bob')
  await app.request('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
    body: JSON.stringify({ roles: { judge: 'deepseek/deepseek-v4' } }),
  })
  const aliceRoles = (await (
    await app.request('/api/settings', { headers: { cookie: alice.cookie } })
  ).json()) as { roles: Record<string, string> }
  const bobRoles = (await (
    await app.request('/api/settings', { headers: { cookie: bob.cookie } })
  ).json()) as { roles: Record<string, string> }
  expect(aliceRoles.roles.judge).toBe('deepseek/deepseek-v4')
  expect(bobRoles.roles.judge).toBe('qwen/j')
})

test('admin can list users; non-admin cannot', async () => {
  const { app, sqlite } = makeApp()
  const admin = await signup(app, 'admin')
  const user = await signup(app, 'user')
  expect((await app.request('/api/users', { headers: { cookie: admin.cookie } })).status).toBe(200)
  expect((await app.request('/api/users', { headers: { cookie: user.cookie } })).status).toBe(403)
  sqlite.close()
})

test('registration can be disabled (after the admin exists)', async () => {
  const { app, sqlite } = makeApp(false)
  await signup(app, 'admin')
  const res = await app.request(
    '/api/auth/register',
    json({ username: 'late', password: 'password123' }),
  )
  expect(res.status).toBe(403)
  sqlite.close()
})

test('per-user OpenRouter key is stored, and settings reports the source', async () => {
  const { app, sqlite } = makeApp()
  const alice = await signup(app, 'alice')
  await app.request('/api/settings/openrouter-key', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
    body: JSON.stringify({ key: 'sk-or-user-123' }),
  })
  const settings = (await (
    await app.request('/api/settings', { headers: { cookie: alice.cookie } })
  ).json()) as {
    openrouter: { key: string }
  }
  expect(settings.openrouter.key).toBe('user')
  sqlite.close()
})

test('placeholder page is served when no build exists', async () => {
  const { app } = makeApp()
  const res = await app.request('/')
  expect(res.status).toBe(200)
  expect(await res.text()).toContain('Tutor')
})

test('sign-in is throttled after repeated wrong passwords, per username', async () => {
  const { app, sqlite } = makeApp()
  const body = (password: string, username = 'carol') => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  await app.request('/api/auth/register', body('password123'))
  for (let i = 0; i < 8; i++) {
    expect((await app.request('/api/auth/login', body('wrong-password'))).status).toBe(401)
  }
  // even the right password is refused while the username is locked
  const locked = await app.request('/api/auth/login', body('password123'))
  expect(locked.status).toBe(429)
  expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0)
  // another username is unaffected, and an unknown one is a plain 401
  expect((await app.request('/api/auth/login', body('x', 'nobody'))).status).toBe(401)
  sqlite.close()
})

test('two registrations at once make exactly one admin', async () => {
  const { app, sqlite } = makeApp()
  const register = (username: string) =>
    app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'password123' }),
    })
  const replies = await Promise.all([register('first'), register('second')])
  const roles = await Promise.all(
    replies.map(async (r) => ((await r.json()) as { user: { role: string } }).user.role),
  )
  expect(roles.sort()).toEqual(['admin', 'user'])
  sqlite.close()
})
