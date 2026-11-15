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

test('the frequency path introduces one word per step (n+1)', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: {
      level: string
      lessons: { id: string; cards: number; newWord?: string; reading?: string }[]
    }[]
  }
  const freq = body.decks.find((d) => d.level === 'zhfreq')!
  expect(freq.lessons.length).toBeGreaterThan(100)
  expect(freq.lessons[0]!.cards).toBe(1)
  expect(freq.lessons[0]!.id).toBe('zhfreq:1')
  expect(freq.lessons[0]!.newWord).toBe('我')
  expect(freq.lessons[0]!.reading).toBe('ㄨㄛˇ')

  // practising step 1 only ever uses its single new word
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }
  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: 'zhfreq:1' })))
  ).json()) as { instance: { cardId: string } }
  expect(cards.cards.find((c) => c.id === next.instance.cardId)?.back).toBe('我')
  sqlite.close()
})

test('sentence_build builds and grades an n+1 sentence once words are known', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }

  // learn the first 35 words (a correct answer with a perfect score graduates
  // a new card straight to review, i.e. "learned")
  for (const card of cards.cards.slice(0, 35)) {
    const res = (await (
      await app.request(
        '/api/practice/grade',
        auth(
          cookie,
          json({
            exerciseId: 'translate.front_to_back',
            cardId: card.id,
            answer: card.back,
          }),
        ),
      )
    ).json()) as { result: { correct: boolean } }
    expect(res.result.correct).toBe(true)
  }

  // the step for 喝 should now be able to build "我 喝 茶"
  const idx = cards.cards.findIndex((c) => c.back === '喝')
  expect(idx).toBeGreaterThanOrEqual(0)
  const card = cards.cards[idx]!
  const built = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ lessonId: `zhfreq:${idx + 1}`, exerciseId: 'sentence_build' })),
    )
  ).json()) as {
    instance: { exerciseId: string; cardId: string; data: { tokens: string[]; bank: string[] } }
  }
  expect(built.instance.exerciseId).toBe('sentence_build')
  expect(built.instance.data.tokens).toContain('喝')
  expect(built.instance.data.bank.length).toBeGreaterThanOrEqual(built.instance.data.tokens.length)

  const graded = (await (
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({
          exerciseId: 'sentence_build',
          cardId: card.id,
          answer: built.instance.data.tokens.join(''),
        }),
      ),
    )
  ).json()) as { result: { correct: boolean; score: number } }
  expect(graded.result.correct).toBe(true)
  expect(graded.result.score).toBe(100)
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
