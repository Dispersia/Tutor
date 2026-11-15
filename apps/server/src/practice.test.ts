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

/** No server key → no LLM judge, so grading is fully deterministic here. */
function makeApp(assess?: Deps['assess']) {
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
    assess,
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
  expect(decks.decks.length).toBe(3)
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
  expect(cat.exercises.length).toBeGreaterThanOrEqual(7)

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

function audioForm(cardId: string, exerciseId: string) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'clip.webm', { type: 'audio/webm' }))
  form.set('cardId', cardId)
  form.set('exerciseId', exerciseId)
  return form
}

test('practice/speak grades recorded audio via the assessor', async () => {
  const assess = async (_audio: Uint8Array, expected: string) => ({
    transcript: expected,
    items: [...expected].map((ch, i) => ({ text: ch, start: i * 0.3, end: i * 0.3 + 0.25 })),
    duration: 0.3 * expected.length,
  })
  const { app, sqlite } = makeApp(assess)
  const cookie = await signup(app)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string }[]
  }
  const deckId = decks.decks.find((d) => d.name === 'HSK 1')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string }[]
  }
  const cardId = cards.cards[0]!.id

  const res = await app.request(
    '/api/practice/speak',
    auth(cookie, { method: 'POST', body: audioForm(cardId, 'speak_word') }),
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    result: { correct: boolean; score: number; detail: { words: unknown[] }; xp: number }
    stats: { xp: number }
  }
  expect(body.result.correct).toBe(true)
  expect(Array.isArray(body.result.detail.words)).toBe(true)
  expect(body.result.xp).toBeGreaterThan(0)
  expect(body.stats.xp).toBe(body.result.xp)
  sqlite.close()
})

test('practice/speak rejects bad input', async () => {
  const assess = async (_a: Uint8Array, expected: string) => ({
    transcript: expected,
    items: [],
    duration: 1,
  })
  const { app, sqlite } = makeApp(assess)
  const cookie = await signup(app)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string }[]
  }
  const deckId = decks.decks[0]!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string }[]
  }

  // no file
  const noFile = new FormData()
  noFile.set('cardId', cards.cards[0]!.id)
  noFile.set('exerciseId', 'speak_word')
  expect(
    (await app.request('/api/practice/speak', auth(cookie, { method: 'POST', body: noFile })))
      .status,
  ).toBe(400)

  // unknown card
  expect(
    (
      await app.request(
        '/api/practice/speak',
        auth(cookie, { method: 'POST', body: audioForm('nope', 'speak_word') }),
      )
    ).status,
  ).toBe(404)

  // exercise that doesn't grade audio
  expect(
    (
      await app.request(
        '/api/practice/speak',
        auth(cookie, {
          method: 'POST',
          body: audioForm(cards.cards[0]!.id, 'translate.front_to_back'),
        }),
      )
    ).status,
  ).toBe(400)

  sqlite.close()
})

test('quiet mode hides listen/speak cards for 15 minutes (XP unaffected)', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string }[]
  }
  const deckId = decks.decks.find((d) => d.name === 'HSK 1')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  const card = cards.cards[0]!

  // Turn the option on.
  const on = (await (
    await app.request('/api/practice/quiet', auth(cookie, json({ enabled: true })))
  ).json()) as { quietUntil: number }
  expect(on.quietUntil).toBeGreaterThan(Date.now())

  // Auto-picked drills never come up as a listen/speak card.
  for (let i = 0; i < 30; i++) {
    const r = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance: { modality: string } }
    expect(r.instance.modality).not.toBe('voice')
  }

  // A forced voice exercise is swapped for a text one instead.
  const forced = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId, exerciseId: 'type_listen' })),
    )
  ).json()) as { instance: { exerciseId: string; modality: string } }
  expect(forced.instance.exerciseId).not.toBe('type_listen')
  expect(forced.instance.modality).not.toBe('voice')

  // Grading a text card still works and still earns its XP.
  const graded = (await (
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({ exerciseId: 'translate.front_to_back', cardId: card.id, answer: card.back }),
      ),
    )
  ).json()) as { result: { correct: boolean; xp: number }; stats: { xp: number } }
  expect(graded.result.correct).toBe(true)
  expect(graded.result.xp).toBeGreaterThan(0)
  expect(graded.stats.xp).toBe(graded.result.xp)

  // Stats reports the open window.
  const stats = (await (await app.request('/api/stats', auth(cookie))).json()) as {
    quietUntil: number
  }
  expect(stats.quietUntil).toBeGreaterThan(0)

  // Turning it off clears the window.
  const off = (await (
    await app.request('/api/practice/quiet', auth(cookie, json({ enabled: false })))
  ).json()) as { quietUntil: number }
  expect(off.quietUntil).toBe(0)

  sqlite.close()
})
