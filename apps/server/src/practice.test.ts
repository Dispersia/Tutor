import { expect, test } from 'bun:test'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import type { Role } from './env'
import { OpenRouter } from './llm/openrouter'
import { SpeechSupervisor } from './speech/supervisor'

const defaults: Record<Role, string> = {
  conversation: 'qwen/c',
  judge: 'qwen/j',
  generator: 'qwen/g',
  translator: 'qwen/t',
}

/** No server key → no LLM judge, so grading is fully deterministic here. */
function makeApp() {
  const { db, sqlite } = openDb(':memory:')
  const deps: Deps = {
    db,
    or: new OpenRouter(undefined, 'http://127.0.0.1:1'),
    supervisor: new SpeechSupervisor({
      url: 'http://127.0.0.1:1',
      port: 1,
      pythonDir: '.',
      modelsDir: '.',
      idleTimeoutMs: 600_000,
      autostart: false,
    }),
    defaults,
    serverKey: undefined,
    secret: undefined,
    allowRegistration: true,
    sessionTtlMs: 86_400_000,
  }
  const app = createApp(deps, { staticDir: '/nope', log: false })
  return { app, db, sqlite }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function signup(app: App, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  return cookie
}

const auth = (cookie: string, extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { ...(extra.headers ?? {}), cookie },
})

test('decks are seeded per user and list their cards', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; cardCount: number }[]
  }
  expect(decks.decks.length).toBe(2)
  expect(decks.decks.every((d) => Number(d.cardCount) > 40)).toBe(true)

  const hsk = decks.decks.find((d) => d.name === 'HSK 1')!
  const cards = (await (await app.request(`/api/decks/${hsk.id}/cards`, auth(cookie))).json()) as {
    cards: { back: string; front: string }[]
  }
  expect(cards.cards.length).toBeGreaterThan(40)
  sqlite.close()
})

test('practice: next -> grade -> xp, and exercise catalog', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

  const cat = (await (await app.request('/api/exercises', auth(cookie))).json()) as {
    exercises: { id: string }[]
  }
  expect(cat.exercises.length).toBeGreaterThanOrEqual(6)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string }[]
  }
  const deckId = decks.decks.find((d) => d.name === 'HSK 1')!.id

  // a specific exercise type (requires auth)
  const nextAuthed = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId, exerciseId: 'multiple_choice' })),
    )
  ).json()) as { instance: { exerciseId: string; cardId: string; data: { choices: string[] } } }
  expect(nextAuthed.instance.exerciseId).toBe('multiple_choice')
  expect(Array.isArray(nextAuthed.instance.data.choices)).toBe(true)

  // fetch a card to grade against a known answer
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  const card = cards.cards[0]!

  const good = (await (
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({
          exerciseId: 'translate.front_to_back',
          cardId: card.id,
          answer: card.back,
          latencyMs: 1200,
        }),
      ),
    )
  ).json()) as { result: { correct: boolean; score: number; xp: number }; stats: { xp: number } }
  expect(good.result.correct).toBe(true)
  expect(good.result.score).toBe(100)
  expect(good.result.xp).toBeGreaterThan(0)
  expect(good.stats.xp).toBe(good.result.xp)

  const bad = (await (
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({
          exerciseId: 'translate.front_to_back',
          cardId: card.id,
          answer: 'definitely wrong',
        }),
      ),
    )
  ).json()) as { result: { correct: boolean } }
  expect(bad.result.correct).toBe(false)

  const stats = (await (await app.request('/api/stats', auth(cookie))).json()) as {
    xp: number
    level: number
  }
  expect(stats.xp).toBeGreaterThan(0)
  expect(stats.level).toBeGreaterThanOrEqual(1)
  sqlite.close()
})

test('practice endpoints require a session', async () => {
  const { app, sqlite } = makeApp()
  for (const [method, path] of [
    ['GET', '/api/decks'],
    ['POST', '/api/practice/next'],
    ['POST', '/api/practice/grade'],
    ['GET', '/api/stats'],
  ] as const) {
    const res = await app.request(path, { method })
    expect(res.status).toBe(401)
  }
  sqlite.close()
})

test('LLM deck generation needs a key', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const res = await app.request(
    '/api/decks',
    auth(cookie, json({ topic: 'food', targetLang: 'zh' })),
  )
  expect(res.status).toBe(502)
  sqlite.close()
})
