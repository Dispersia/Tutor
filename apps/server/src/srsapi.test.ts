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

async function signup(app: App, db: Db, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  // Decks are no longer pre-seeded; tests drill the curated fixture decks.
  const { user } = (await res.json()) as { user: { id: string } }
  seedStarterDecks(db, user.id)
  return cookie
}

test('GET /api/curriculum returns the frequency decks split into one-word steps', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const body = (await (await app.request('/api/curriculum', auth(cookie))).json()) as {
    decks: {
      name: string
      level: string
      learned: number
      lessons: { id: string; title: string; cards: number; learned: number; complete: boolean }[]
    }[]
  }
  const freq = body.decks.find((d) => d.level === 'zhfreq')!
  expect(freq.lessons.length).toBeGreaterThan(100)
  expect(freq.lessons[0]!.id).toBe('zhfreq:1')
  expect(freq.lessons[0]!.title).toBe('我')
  expect(freq.lessons[0]!.cards).toBe(1)
  expect(freq.lessons.every((l) => !l.complete)).toBe(true)
  expect(freq.learned).toBe(0)
  // the Japanese path is there too, with no themed decks left
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

  // a step drill only uses that step's card
  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: 'zhfreq:1' })))
  ).json()) as { instance: { cardId: string } }
  expect(next.instance.cardId).toBe(first.id)

  // grade the step's card correctly until it graduates through its learning steps
  let last: { lessonCompleted: boolean } = { lessonCompleted: false }
  for (let pass = 0; pass < 8 && !last.lessonCompleted; pass++) {
    const res = (await (
      await app.request(
        '/api/practice/grade',
        auth(
          cookie,
          json({
            exerciseId: 'multiple_choice',
            cardId: first.id,
            answer: first.back,
            lessonId: 'zhfreq:1',
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
  expect(freq.lessons.find((l) => l.id === 'zhfreq:1')!.complete).toBe(true)
  expect(freq.lessons.find((l) => l.id === 'zhfreq:2')!.complete).toBe(false)
  sqlite.close()
})

test('the daily new-card limit no longer stops the path — pressing on serves new words', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  // A tiny budget keeps the test quick: 2 new cards and 2 reviews today.
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

  // One answer each on two brand-new cards spends the whole day's budget.
  for (const card of cards.cards.slice(0, 2)) {
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({ exerciseId: 'translate.front_to_back', cardId: card.id, answer: card.back }),
      ),
    )
  }

  // The budget is spent, but the deck still has new words: practice keeps
  // serving them rather than showing the "done" screen.
  const resumed = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId })))
  ).json()) as { instance: { exerciseId: string; cardId: string } | null; done?: boolean }
  expect(resumed.done).toBeFalsy()
  expect(resumed.instance?.cardId).toBeTruthy()

  // The allowance was raised to cover it, so the header stays honest.
  const stats = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    budget: { newRemaining: number }
  }
  expect(stats.budget.newRemaining).toBeGreaterThan(0)

  // "Study more" still works as the explicit escape hatch.
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
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  // This test wants unlimited new cards so the budget never blocks the lesson.
  await app.request(
    '/api/settings',
    auth(cookie, { ...json({ study: { newPerDay: 0, maxReviewsPerDay: 0 } }), method: 'PUT' }),
  )
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const freqDeck = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (
    await app.request(`/api/decks/${freqDeck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string; back: string }[] }

  // learn the first 35 words: grade each until it graduates through its steps
  for (const card of cards.cards.slice(0, 35)) {
    for (let pass = 0; pass < 5; pass++) {
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
  }

  // the step for 喝 should now be able to build "我 喝 茶"
  const idx = cards.cards.findIndex((c) => c.back === '喝')
  expect(idx).toBeGreaterThanOrEqual(0)
  const card = cards.cards[idx]!
  const built = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ cardId: card.id, exerciseId: 'sentence_build' })),
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

  // first exposure: a teach step, never a quiz
  const taught = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
  ).json()) as { instance: { exerciseId: string; cardId: string; data: Record<string, unknown> } }
  expect(taught.instance.exerciseId).toBe('introduce')
  expect(taught.instance.cardId).toBe(first.id)
  expect(taught.instance.data.word).toBe(first.back)
  expect(taught.instance.data.reading).toBe('ㄨㄛˇ') // Zhuyin, never pinyin

  // the teach step is not a review: nothing has entered the SRS yet
  const before = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    new: number
    total: number
  }
  expect(before.new).toBe(before.total)

  await app.request(
    '/api/practice/grade',
    auth(cookie, json({ exerciseId: 'introduce', cardId: first.id, answer: 'ok' })),
  )

  // once introduced, the same word comes back as a normal drill
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

  // Grade the "Meet a new word" step while drilling an action. It is a prelude,
  // not a drill: it must not power that action's rig (no completion, no run).
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

    // first exposure teaches the word
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
      // n+1: every character comes from a word already met, or the new word
      const allowed = new Set([...seen, card.back].flatMap((b) => [...b]))
      for (const ch of ex.text) expect(allowed.has(ch)).toBe(true)
      expect(ex.target).toBe(card.back)
      expect(ex.reading).toMatch(/[\u3100-\u312f]/) // Zhuyin, never pinyin
    }

    await app.request(
      '/api/practice/grade',
      auth(cookie, json({ exerciseId: 'introduce', cardId: card.id, answer: 'ok' })),
    )
    seen.push(card.back)

    // then the same word is drilled
    const drilled = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId: freqDeck.id })))
    ).json()) as { instance: { exerciseId: string; cardId: string } }
    expect(drilled.instance.exerciseId).not.toBe('introduce')
    expect(drilled.instance.cardId).toBe(card.id)
    // a miss reschedules it, so the path advances to the next new word
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
  // a lapse reschedules the card ~10 minutes out (not due yet), and it is no
  // longer "new"; nothing has been learned
  expect(stats.due).toBe(0)
  expect(stats.learned).toBe(0)
  expect(stats.new).toBe(stats.total - 1)
  sqlite.close()
})

test('a sitting opens with a few new words before the due backlog', async () => {
  const { app, db, sqlite } = makeApp()
  const res = await app.request(
    '/api/auth/register',
    json({ username: 'warmup', password: 'password123' }),
  )
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const { user } = (await res.json()) as { user: { id: string } }
  seedStarterDecks(db, user.id)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  // Put one word deep in the deck into review, due now: it is the card the
  // due-first queue would serve immediately.
  const due = cards.cards.at(-1)!
  const now = Date.now()
  upsertSrs(db, user.id, due.id, {
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

  // The sitting starts with three new words in a row, not the overdue review.
  const opened: string[] = []
  for (let i = 0; i < 3; i++) {
    const step = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance: { exerciseId: string; cardId: string } }
    expect(step.instance.exerciseId).toBe('introduce')
    expect(step.instance.cardId).not.toBe(due.id)
    opened.push(step.instance.cardId)
    await app.request(
      '/api/practice/grade',
      auth(cookie, json({ exerciseId: 'introduce', cardId: step.instance.cardId, answer: 'ok' })),
    )
    // the same word comes back as its first graded drill (this is what gives it
    // an SRS state; the teach step alone does not)
    const drill = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance: { exerciseId: string; cardId: string } }
    expect(drill.instance.cardId).toBe(step.instance.cardId)
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({ exerciseId: drill.instance.exerciseId, cardId: drill.instance.cardId, answer: '~' }),
      ),
    )
  }
  expect(new Set(opened).size).toBe(3)

  // Once the sitting has had its new words, the due review comes back first.
  const after = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
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

  // Learn the step's word: teach, then its first graded drill.
  const taught = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: 'zhfreq:1' })))
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
      auth(cookie, json({ lessonId: 'zhfreq:1', exerciseId: 'multiple_choice' })),
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
        lessonId: 'zhfreq:1',
      }),
    ),
  )

  // Its next learning step is a minute out: the queue teaches the path's next
  // word instead of showing the same word again and again.
  const after = (await (
    await app.request('/api/practice/next', auth(cookie, json({ lessonId: 'zhfreq:1' })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  expect(after.instance.cardId).not.toBe(first.id)
  expect(after.instance.exerciseId).toBe('introduce')
  sqlite.close()
})
