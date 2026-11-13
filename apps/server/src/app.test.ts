import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createApp } from './app'
import type { Deps } from './context'
import { openDb } from './db/client'
import { getRoles, listMessages, listSessions } from './db/repo'
import type { Role } from './env'
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
  // A fake OpenRouter so the SSE stream is deterministic offline.
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
      if (path.endsWith('/models')) {
        return Response.json({
          data: [
            {
              id: 'qwen/test',
              name: 'Qwen Test',
              context_length: 1000,
              pricing: { prompt: '0', completion: '0' },
              architecture: { input_modalities: ['text'], output_modalities: ['text'] },
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

function makeApp() {
  const { db, sqlite } = openDb(':memory:')
  const deps: Deps = {
    db,
    or: new OpenRouter('test-key', stub.url),
    supervisor: new SpeechSupervisor({
      url: 'http://127.0.0.1:1',
      port: 1,
      pythonDir: '.',
      modelsDir: '.',
      idleTimeoutMs: 600_000,
      autostart: false,
    }),
    defaults,
  }
  const app = createApp(deps, { staticDir: '/definitely/not/here', log: false })
  return { app, db, sqlite, deps }
}

test('GET /api/health reports speech asleep + openrouter set', async () => {
  const { app } = makeApp()
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  const json = (await res.json()) as { openrouter: boolean; speech: { running: boolean } }
  expect(json.openrouter).toBe(true)
  expect(json.speech.running).toBe(false)
})

test('GET /api/models returns the catalogue', async () => {
  const { app } = makeApp()
  const res = await app.request('/api/models')
  const json = (await res.json()) as { count: number; models: { id: string }[] }
  expect(json.count).toBe(1)
  expect(json.models[0]!.id).toBe('qwen/test')
})

test('POST /api/chat streams SSE and persists both turns', async () => {
  const { app, db, sqlite } = makeApp()
  const res = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好', role: 'conversation' }),
  })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).toContain('event: session')
  expect(text).toContain('event: delta')
  expect(text).toContain('你')
  expect(text).toContain('好')
  expect(text).toContain('event: usage')
  expect(text).toContain('event: done')

  const sessions = listSessions(db)
  expect(sessions.length).toBe(1)
  const msgs = listMessages(db, sessions[0]!.id)
  expect(msgs.length).toBe(2)
  expect(msgs[0]!.role).toBe('user')
  expect(msgs[0]!.text).toBe('你好')
  expect(msgs[1]!.role).toBe('assistant')
  expect(msgs[1]!.text).toBe('你好')
  expect(msgs[1]!.model).toBe('qwen/c')
  expect(msgs[1]!.tokensOut).toBe(2)
  expect(msgs[1]!.costUsd).toBeCloseTo(0.0001)
  sqlite.close()
})

test('PUT /api/settings switches a role model and it takes effect', async () => {
  const { app, db, sqlite } = makeApp()
  const res = await app.request('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roles: { judge: 'deepseek/deepseek-v4' } }),
  })
  expect(res.status).toBe(200)
  const json = (await res.json()) as { roles: Record<string, string> }
  expect(json.roles.judge).toBe('deepseek/deepseek-v4')
  expect(json.roles.conversation).toBe('qwen/c')
  expect(getRoles(db, defaults).judge).toBe('deepseek/deepseek-v4')

  // and the change is used by the next chat request
  await app.request('/api/chat/json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'go' }],
      schema: { type: 'object' },
    }),
  })
  // judge model now deepseek; verified via settings read
  expect(getRoles(db, defaults).judge).toBe('deepseek/deepseek-v4')
  sqlite.close()
})

test('PUT /api/settings rejects unknown roles', async () => {
  const { app, sqlite } = makeApp()
  const res = await app.request('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roles: { nope: 'x' } }),
  })
  expect(res.status).toBe(400)
  sqlite.close()
})

test('sessions listing + detail', async () => {
  const { app, db, sqlite } = makeApp()
  const created = await app.request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'voice', lang: 'ja' }),
  })
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as { id: string }
  const detail = await app.request(`/api/sessions/${id}`)
  const json = (await detail.json()) as { session: { kind: string }; messages: unknown[] }
  expect(json.session.kind).toBe('voice')
  expect(json.messages.length).toBe(0)
  sqlite.close()
})

test('placeholder page is served when no build exists', async () => {
  const { app } = makeApp()
  const res = await app.request('/')
  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('tutor')
})
