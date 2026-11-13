import { expect, test } from 'bun:test'
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
    events: new EventBus(),
  }
  const app = createApp(deps, { staticDir: '/nope', log: false })
  return { app, db, sqlite }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const auth = (cookie: string, extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { ...(extra.headers ?? {}), cookie },
})

async function signup(app: App, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  return res.headers.getSetCookie()[0]!.split(';')[0]!
}

test('GET /api/curriculum returns decks split into lessons', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: {
      name: string
      level: string
      learned: number
      lessons: { id: string; title: string; cards: number; learned: number; complete: boolean }[]
    }[]
  }
  const hsk = body.decks.find((d) => d.level === 'hsk1')!
  expect(hsk.lessons.length).toBeGreaterThan(3)
  expect(hsk.lessons[0]!.id).toBe('hsk1:1')
  expect(hsk.lessons[0]!.title).toBe('Greetings')
  expect(hsk.lessons[0]!.cards).toBe(8)
  expect(hsk.lessons.every((l) => !l.complete)).toBe(true)
  expect(hsk.learned).toBe(0)
  sqlite.close()
})

test('practising a lesson stays inside it and records spaced repetition', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string }[]
  }
  const deckId = decks.decks.find((d) => d.name === 'HSK 1')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  const lessonCards = cards.cards.slice(0, 8)

  // a lesson drill only uses that lesson's cards
  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: 'hsk1:1' })))
  ).json()) as { instance: { cardId: string } }
  expect(lessonCards.map((c) => c.id)).toContain(next.instance.cardId)

  // grade every lesson card correctly twice → the lesson completes
  let last: { lessonCompleted: boolean } = { lessonCompleted: false }
  for (let pass = 0; pass < 2; pass++) {
    for (const card of lessonCards) {
      const res = (await (
        await app.request(
          '/api/practice/grade',
          auth(
            cookie,
            json({
              exerciseId: 'multiple_choice',
              cardId: card.id,
              answer: card.back,
              lessonId: 'hsk1:1',
            }),
          ),
        )
      ).json()) as { result: { correct: boolean }; lessonCompleted: boolean }
      expect(res.result.correct).toBe(true)
      last = res
    }
  }
  expect(last.lessonCompleted).toBe(true)

  const stats = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    learned: number
    total: number
    new: number
    due: number
  }
  expect(stats.learned).toBeGreaterThanOrEqual(8)
  expect(stats.total).toBeGreaterThan(40)
  expect(stats.new).toBeLessThan(stats.total)

  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: { level: string; learned: number; lessons: { id: string; complete: boolean }[] }[]
  }
  const hsk = body.decks.find((d) => d.level === 'hsk1')!
  expect(hsk.learned).toBeGreaterThanOrEqual(8)
  expect(hsk.lessons.find((l) => l.id === 'hsk1:1')!.complete).toBe(true)
  expect(hsk.lessons.find((l) => l.id === 'hsk1:2')!.complete).toBe(false)
  sqlite.close()
})

test('a wrong answer schedules the card to come back soon', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string }[]
  }
  const cards = (await (
    await app.request(`/api/decks/${decks.decks[0]!.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string }[] }
  const cardId = cards.cards[0]!.id

  await app.request(
    '/api/practice/grade',
    auth(cookie, json({ exerciseId: 'multiple_choice', cardId, answer: 'definitely wrong' })),
  )
  const stats = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    due: number
    learned: number
    new: number
    total: number
  }
  // a lapse reschedules the card ~10 minutes out (not due yet), and it is no
  // longer "new"; nothing has been learned
  expect(stats.due).toBe(0)
  expect(stats.learned).toBe(0)
  expect(stats.new).toBe(stats.total - 1)
  sqlite.close()
})
