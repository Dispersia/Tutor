import { toCardId, type UserId } from './ids'
import { expect, test } from 'bun:test'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import type { Db } from './db/client'
import { upsertSrs } from './db/repo'
import type { Role } from './env'
import { EventBus } from './events'
import { OpenRouter } from './llm/openrouter'
import { seedStarterDecks } from './seed/service'
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

async function getJson<T>(app: App, cookie: string, path: string): Promise<T> {
  return (await (await app.request(path, auth(cookie))).json()) as T
}

async function postJson<T>(app: App, cookie: string, path: string, body: unknown): Promise<T> {
  return (await (await app.request(path, auth(cookie, json(body)))).json()) as T
}

async function putJson<T>(app: App, cookie: string, path: string, body: unknown): Promise<T> {
  return (await (
    await app.request(path, auth(cookie, { ...json(body), method: 'PUT' }))
  ).json()) as T
}

async function signupUser(app: App, db: Db, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const { user } = (await res.json()) as { user: { id: UserId } }
  seedStarterDecks(db, user.id)
  return { cookie, user }
}

async function signup(app: App, db: Db, username = 'alice') {
  return (await signupUser(app, db, username)).cookie
}

interface Step {
  instance: { exerciseId: string; cardId: string }
}

function nextStep(app: App, cookie: string, body: unknown): Promise<Step> {
  return postJson<Step>(app, cookie, '/api/practice/next', body)
}

test('GET /api/curriculum returns the frequency decks split into one-word steps', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: {
      name: string
      level: string
      deckId: string
      learned: number
      lessons: { id: string; title: string; cards: number; learned: number; complete: boolean }[]
    }[]
  }
  const freq = body.decks.find((d) => d.level === 'zhfreq')!
  expect(freq.lessons.length).toBeGreaterThan(100)
  expect(freq.lessons[0]!.id).toBe(`${freq.deckId}:1`)
  expect(freq.lessons[0]!.title).toBe('我')
  expect(freq.lessons[0]!.cards).toBe(1)
  expect(freq.lessons.every((l) => !l.complete)).toBe(true)
  expect(freq.learned).toBe(0)
  expect(body.decks.some((d) => d.level === 'jafreq')).toBe(true)
  expect(body.decks.some((d) => d.level === 'hsk1' || d.level === 'n5')).toBe(false)
  sqlite.close()
})

test('practising a step stays inside it and records spaced repetition', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  const first = cards.cards[0]!

  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: `${deckId}:1` })))
  ).json()) as { instance: { cardId: string } }
  expect(next.instance.cardId).toBe(first.id)

  let last: { lessonCompleted: boolean } = { lessonCompleted: false }
  const drill = { deckId, cardId: first.id, exerciseId: 'multiple_choice' }
  for (let pass = 0; pass < 8 && !last.lessonCompleted; pass++) {
    await app.request('/api/practice/next', auth(cookie, json(drill)))
    const res = (await (
      await app.request(
        '/api/practice/grade',
        auth(
          cookie,
          json({
            exerciseId: 'multiple_choice',
            cardId: first.id,
            answer: first.back,
            lessonId: `${deckId}:1`,
          }),
        ),
      )
    ).json()) as { result: { correct: boolean }; lessonCompleted: boolean }
    expect(res.result.correct).toBe(true)
    last = res
  }
  expect(last.lessonCompleted).toBe(true)

  const stats = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    learned: number
    total: number
    new: number
    due: number
  }
  expect(stats.learned).toBeGreaterThanOrEqual(1)
  expect(stats.total).toBeGreaterThan(100)
  expect(stats.new).toBeLessThan(stats.total)

  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: { level: string; learned: number; lessons: { id: string; complete: boolean }[] }[]
  }
  const freq = body.decks.find((d) => d.level === 'zhfreq')!
  expect(freq.learned).toBeGreaterThanOrEqual(1)
  expect(freq.lessons.find((l) => l.id === `${deckId}:1`)!.complete).toBe(true)
  expect(freq.lessons.find((l) => l.id === `${deckId}:2`)!.complete).toBe(false)
  sqlite.close()
})

test('the daily new-card limit no longer stops the path — pressing on serves new words', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  await app.request(
    '/api/settings',
    auth(cookie, { ...json({ study: { newPerDay: 2, maxReviewsPerDay: 2 } }), method: 'PUT' }),
  )
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }

  for (const card of cards.cards.slice(0, 2)) {
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({ exerciseId: 'translate.front_to_back', cardId: card.id, answer: card.back }),
      ),
    )
  }

  const resumed = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId })))
  ).json()) as { instance: { exerciseId: string; cardId: string } | null; done?: boolean }
  expect(resumed.done).toBeFalsy()
  expect(resumed.instance?.cardId).toBeTruthy()

  const stats = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    budget: { newRemaining: number }
  }
  expect(stats.budget.newRemaining).toBeGreaterThan(0)

  const more = (await (
    await app.request('/api/study/more', auth(cookie, { method: 'POST' }))
  ).json()) as { budget: { newRemaining: number; reviewsRemaining: number } }
  expect(more.budget.newRemaining).toBeGreaterThan(0)
  sqlite.close()
})

test('the frequency path introduces one word per step (n+1)', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: {
      level: string
      deckId: string
      lessons: { id: string; cards: number; newWord?: string; reading?: string }[]
    }[]
  }
  const freq = body.decks.find((d) => d.level === 'zhfreq')!
  expect(freq.lessons.length).toBeGreaterThan(100)
  expect(freq.lessons[0]!.cards).toBe(1)
  expect(freq.lessons[0]!.id).toBe(`${freq.deckId}:1`)
  expect(freq.lessons[0]!.newWord).toBe('我')
  expect(freq.lessons[0]!.reading).toBe('ㄨㄛˇ')

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }
  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: `${freqDeck.id}:1` })))
  ).json()) as { instance: { cardId: string } }
  expect(cards.cards.find((c) => c.id === next.instance.cardId)?.back).toBe('我')
  sqlite.close()
})

test('sentence_build builds and grades an n+1 sentence once words are known', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  await putJson(app, cookie, '/api/settings', { study: { newPerDay: 0, maxReviewsPerDay: 0 } })
  const decks = await getJson<{ decks: { id: string; level: string }[] }>(app, cookie, '/api/decks')
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = await getJson<{ cards: { id: string; back: string }[] }>(
    app,
    cookie,
    `/api/decks/${freqDeck.id}/cards`,
  )
  await learnWords(app, cookie, cards.cards, 35)

  const idx = cards.cards.findIndex((c) => c.back === '喝')
  expect(idx).toBeGreaterThanOrEqual(0)
  const card = cards.cards[idx]!
  const built = await postJson<{
    instance: { exerciseId: string; cardId: string; data: { tokens: string[]; bank: string[] } }
  }>(app, cookie, '/api/practice/next', { cardId: card.id, exerciseId: 'sentence_build' })
  expect(built.instance.exerciseId).toBe('sentence_build')
  expect(built.instance.data.tokens).toContain('喝')
  expect(built.instance.data.bank.length).toBeGreaterThanOrEqual(built.instance.data.tokens.length)

  const graded = await postJson<{ result: { correct: boolean; score: number } }>(
    app,
    cookie,
    '/api/practice/grade',
    {
      exerciseId: 'sentence_build',
      cardId: card.id,
      answer: built.instance.data.tokens.join(''),
    },
  )
  expect(graded.result.correct).toBe(true)
  expect(graded.result.score).toBe(100)
  sqlite.close()
})

async function learnWords(
  app: App,
  cookie: string,
  cards: { id: string; back: string }[],
  count: number,
) {
  for (const card of cards.slice(0, count)) {
    for (let pass = 0; pass < 5; pass++) {
      const res = await postJson<{ result: { correct: boolean } }>(
        app,
        cookie,
        '/api/practice/grade',
        { exerciseId: 'translate.front_to_back', cardId: card.id, answer: card.back },
      )
      expect(res.result.correct).toBe(true)
    }
  }
}

test('a new card is taught before it is quizzed', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }
  const first = cards.cards[0]!

  const taught = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
  ).json()) as { instance: { exerciseId: string; cardId: string; data: Record<string, unknown> } }
  expect(taught.instance.exerciseId).toBe('introduce')
  expect(taught.instance.cardId).toBe(first.id)
  expect(taught.instance.data.word).toBe(first.back)
  expect(taught.instance.data.reading).toBe('ㄨㄛˇ')

  const before = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    new: number
    total: number
  }
  expect(before.new).toBe(before.total)

  await app.request(
    '/api/practice/grade',
    auth(cookie, json({ exerciseId: 'introduce', cardId: first.id, answer: 'ok' })),
  )

  const drilled = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  expect(drilled.instance.exerciseId).not.toBe('introduce')
  expect(drilled.instance.cardId).toBe(first.id)
  sqlite.close()
})

test('the first-exposure teach step never powers an idle rig', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }
  const first = cards.cards[0]!

  const taught = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  expect(taught.instance.exerciseId).toBe('introduce')

  await app.request(
    '/api/practice/grade',
    auth(
      cookie,
      json({ exerciseId: 'introduce', cardId: first.id, answer: 'ok', actionId: 'mine-copper' }),
    ),
  )

  const skills = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    skills: { actions: { id: string; idle: { completions: number } | null }[] }[]
  }
  const copper = skills.skills.flatMap((s) => s.actions).find((a) => a.id === 'mine-copper')!
  expect(copper.idle).toBeNull()
  sqlite.close()
})

test('teach steps include an n+1 example built from words already met', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }

  const seen: string[] = []
  let sawExample = false

  for (let i = 0; i < 8; i++) {
    const card = cards.cards[i]!

    const taught = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
    ).json()) as {
      instance: { exerciseId: string; cardId: string; data: Record<string, unknown> }
    }
    expect(taught.instance.exerciseId).toBe('introduce')
    expect(taught.instance.cardId).toBe(card.id)

    const ex = taught.instance.data.example as
      { text: string; reading: string; target: string } | undefined
    if (ex) {
      sawExample = true
      const allowed = new Set([...seen, card.back].flatMap((b) => [...b]))
      for (const ch of ex.text) expect(allowed.has(ch)).toBe(true)
      expect(ex.target).toBe(card.back)
      expect(ex.reading).toMatch(/[\u3100-\u312f]/)
    }

    await app.request(
      '/api/practice/grade',
      auth(cookie, json({ exerciseId: 'introduce', cardId: card.id, answer: 'ok' })),
    )
    seen.push(card.back)

    const drilled = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
    ).json()) as { instance: { exerciseId: string; cardId: string } }
    expect(drilled.instance.exerciseId).not.toBe('introduce')
    expect(drilled.instance.cardId).toBe(card.id)
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({ exerciseId: drilled.instance.exerciseId, cardId: card.id, answer: 'wrong' }),
      ),
    )
  }

  expect(sawExample).toBe(true)
  sqlite.close()
})

test('a wrong answer schedules the card to come back soon', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
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
  expect(stats.due).toBe(0)
  expect(stats.learned).toBe(0)
  expect(stats.new).toBe(stats.total - 1)
  sqlite.close()
})

test('a sitting opens with a few new words before the due backlog', async () => {
  const { app, db, sqlite } = makeApp()
  const { cookie, user } = await signupUser(app, db, 'warmup')

  const decks = await getJson<{ decks: { id: string; level: string }[] }>(app, cookie, '/api/decks')
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = await getJson<{ cards: { id: string; back: string }[] }>(
    app,
    cookie,
    `/api/decks/${deckId}/cards`,
  )
  const due = cards.cards.at(-1)!
  const now = Date.now()
  upsertSrs(db, user.id, toCardId(due.id), {
    state: 'review',
    step: 0,
    stability: 5,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    intervalDays: 3,
    dueAt: now - 1000,
    lastRating: 3,
    lastReviewAt: now - 86_400_000,
  })

  const opened: string[] = []
  for (let i = 0; i < 3; i++) {
    const step = await nextStep(app, cookie, { deckId })
    expect(step.instance.exerciseId).toBe('introduce')
    expect(step.instance.cardId).not.toBe(due.id)
    opened.push(step.instance.cardId)
    await postJson(app, cookie, '/api/practice/grade', {
      exerciseId: 'introduce',
      cardId: step.instance.cardId,
      answer: 'ok',
    })
    const drill = await nextStep(app, cookie, { deckId })
    expect(drill.instance.cardId).toBe(step.instance.cardId)
    await postJson(app, cookie, '/api/practice/grade', {
      exerciseId: drill.instance.exerciseId,
      cardId: drill.instance.cardId,
      answer: '~',
    })
  }
  expect(new Set(opened).size).toBe(3)

  const after = await nextStep(app, cookie, { deckId })
  expect(after.instance.cardId).toBe(due.id)
  expect(after.instance.exerciseId).not.toBe('introduce')
  sqlite.close()
})

test('a one-word lesson does not re-show its word before the next step is due', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  const first = cards.cards[0]!

  const taught = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: `${deckId}:1` })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  expect(taught.instance.exerciseId).toBe('introduce')
  expect(taught.instance.cardId).toBe(first.id)
  await app.request(
    '/api/practice/grade',
    auth(cookie, json({ exerciseId: 'introduce', cardId: first.id, answer: 'ok' })),
  )
  const drilled = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ lessonId: `${deckId}:1`, exerciseId: 'multiple_choice' })),
    )
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  expect(drilled.instance.cardId).toBe(first.id)
  await app.request(
    '/api/practice/grade',
    auth(
      cookie,
      json({
        exerciseId: 'multiple_choice',
        cardId: first.id,
        answer: first.back,
        lessonId: `${deckId}:1`,
      }),
    ),
  )

  const after = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: `${deckId}:1` })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  expect(after.instance.cardId).not.toBe(first.id)
  expect(after.instance.exerciseId).toBe('introduce')
  sqlite.close()
})
