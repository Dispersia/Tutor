import { toCardId, type UserId } from './ids'
import { expect, test } from 'bun:test'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import type { Db } from './db/client'
import { addCard, createDeck, listUsers, upsertSrs } from './db/repo'
import type { Role } from './env'
import { EventBus } from './events'
import { OpenRouter } from './llm/openrouter'
import { createFixtureDecks } from './deckFixture'
import { SpeechSupervisor } from './speech/supervisor'

const defaults: Record<Role, string> = {
  conversation: 'qwen/c',
  judge: 'qwen/j',
  generator: 'qwen/g',
  translator: 'qwen/t',
}

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

async function signup(app: App, db: Db, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const { user } = (await res.json()) as { user: { id: UserId } }
  createFixtureDecks(db, user.id)
  return cookie
}

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

test('decks are seeded per user and list their cards', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string; cardCount: number }[]
  }
  expect(decks.decks.length).toBe(2)
  expect(decks.decks.every((d) => Number(d.cardCount) > 40)).toBe(true)

  const zh = decks.decks.find((d) => d.level === 'zhfreq')!
  const cards = (await (await app.request(`/api/decks/${zh.id}/cards`, auth(cookie))).json()) as {
    cards: { back: string; front: string }[]
  }
  expect(cards.cards.length).toBeGreaterThan(40)
  sqlite.close()
})

test('practice: next -> grade -> xp, and exercise catalog', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const cat = await getJson<{ exercises: { id: string }[] }>(app, cookie, '/api/exercises')
  expect(cat.exercises.length).toBeGreaterThanOrEqual(7)

  const decks = await getJson<{ decks: { id: string; name: string; level: string }[] }>(
    app,
    cookie,
    '/api/decks',
  )
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id

  const next = await postJson<{
    instance: { exerciseId: string; cardId: string; data: { choices: string[] } }
  }>(app, cookie, '/api/practice/next', { deckId, exerciseId: 'multiple_choice' })
  expect(next.instance.exerciseId).toBe('multiple_choice')
  expect(Array.isArray(next.instance.data.choices)).toBe(true)

  const cards = await getJson<{ cards: { id: string; back: string }[] }>(
    app,
    cookie,
    `/api/decks/${deckId}/cards`,
  )
  const card = cards.cards[0]!
  const drill = { deckId, cardId: card.id, exerciseId: 'translate.front_to_back' }
  await postJson(app, cookie, '/api/practice/next', drill)

  const good = await postJson<{
    result: { correct: boolean; score: number; xp: number }
    stats: { xp: number }
  }>(app, cookie, '/api/practice/grade', {
    exerciseId: 'translate.front_to_back',
    cardId: card.id,
    answer: card.back,
    latencyMs: 1200,
  })
  expect(good.result.correct).toBe(true)
  expect(good.result.score).toBe(100)
  expect(good.result.xp).toBeGreaterThan(0)
  expect(good.stats.xp).toBe(good.result.xp)

  const bad = await postJson<{ result: { correct: boolean } }>(app, cookie, '/api/practice/grade', {
    exerciseId: 'translate.front_to_back',
    cardId: card.id,
    answer: 'definitely wrong',
  })
  expect(bad.result.correct).toBe(false)

  const stats = await getJson<{ xp: number; level: number }>(app, cookie, '/api/stats')
  expect(stats.xp).toBeGreaterThan(0)
  expect(stats.level).toBeGreaterThanOrEqual(1)
  sqlite.close()
})

test('listen drills do not warm the speech model', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = await getJson<{ decks: { id: string; level: string }[] }>(app, cookie, '/api/decks')
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const sentence = await addSentence(app, cookie, deckId)

  const listen = await postJson<{ instance: { exerciseId: string; needsSpeech?: boolean } }>(
    app,
    cookie,
    '/api/practice/next',
    { deckId, cardId: sentence, exerciseId: 'type_listen' },
  )
  expect(listen.instance.exerciseId).toBe('type_listen')
  expect(listen.instance.needsSpeech).toBe(false)
  sqlite.close()
})

test('voice drills are only offered for sentences, never single words', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = await getJson<{ decks: { id: string; level: string }[] }>(app, cookie, '/api/decks')
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = await getJson<{ cards: { id: string }[] }>(
    app,
    cookie,
    `/api/decks/${deckId}/cards`,
  )
  const word = cards.cards[0]!.id
  const sentence = await addSentence(app, cookie, deckId)

  for (const exerciseId of ['type_listen', 'speak_word']) {
    const forced = await postJson<{ instance: { exerciseId: string } }>(
      app,
      cookie,
      '/api/practice/next',
      { deckId, cardId: word, exerciseId },
    )
    expect(forced.instance.exerciseId).not.toBe(exerciseId)

    const served = await postJson<{ instance: { exerciseId: string } }>(
      app,
      cookie,
      '/api/practice/next',
      { deckId, cardId: sentence, exerciseId },
    )
    expect(served.instance.exerciseId).toBe(exerciseId)
  }
  sqlite.close()
})

async function addSentence(app: App, cookie: string, deckId: string): Promise<string> {
  const made = (await (
    await app.request(
      `/api/decks/${deckId}/cards`,
      auth(cookie, json({ front: 'I drink tea.', back: '我喝茶。', type: 'phrase' })),
    )
  ).json()) as { card: { id: string } }
  return made.card.id
}

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
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const res = await app.request(
    '/api/decks',
    auth(cookie, json({ topic: 'food', targetLang: 'zh' })),
  )
  expect(res.status).toBe(409)
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
  const { app, db, sqlite } = makeApp(assess)
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
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

test('practice/speak retry is graded but never counted', async () => {
  const assess = async (_audio: Uint8Array, expected: string) => ({
    transcript: expected,
    items: [...expected].map((ch, i) => ({ text: ch, start: i * 0.3, end: i * 0.3 + 0.25 })),
    duration: 0.3 * expected.length,
  })
  const { app, db, sqlite } = makeApp(assess)
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string }[]
  }
  const cardId = cards.cards[0]!.id

  const form = audioForm(cardId, 'speak_word')
  form.set('retry', 'true')
  const res = await app.request('/api/practice/speak', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    result: { correct: boolean; score: number; xp: number }
    srs: unknown
    stats: { xp: number }
  }
  expect(body.result.correct).toBe(true)
  expect(body.result.score).toBeGreaterThan(0)
  expect(body.result.xp).toBe(0)
  expect(body.srs).toBeNull()
  expect(body.stats.xp).toBe(0)
  sqlite.close()
})

test('practice/speak rejects bad input', async () => {
  const assess = async (_a: Uint8Array, expected: string) => ({
    transcript: expected,
    items: [],
    duration: 1,
  })
  const { app, db, sqlite } = makeApp(assess)
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks[0]!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string }[]
  }

  const noFile = new FormData()
  noFile.set('cardId', cards.cards[0]!.id)
  noFile.set('exerciseId', 'speak_word')
  expect(
    (await app.request('/api/practice/speak', auth(cookie, { method: 'POST', body: noFile })))
      .status,
  ).toBe(400)

  expect(
    (
      await app.request(
        '/api/practice/speak',
        auth(cookie, { method: 'POST', body: audioForm('nope', 'speak_word') }),
      )
    ).status,
  ).toBe(404)

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
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string; back: string }[]
  }
  const card = cards.cards[0]!

  const on = (await (
    await app.request('/api/practice/quiet', auth(cookie, json({ enabled: true })))
  ).json()) as { quietUntil: number }
  expect(on.quietUntil).toBeGreaterThan(Date.now())

  for (let i = 0; i < 30; i++) {
    const r = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance: { modality: string } }
    expect(r.instance.modality).not.toBe('voice')
  }

  const forced = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId, exerciseId: 'type_listen' })),
    )
  ).json()) as { instance: { exerciseId: string; modality: string } }
  expect(forced.instance.exerciseId).not.toBe('type_listen')
  expect(forced.instance.modality).not.toBe('voice')

  const drill = { deckId, cardId: card.id, exerciseId: 'translate.front_to_back' }
  await app.request('/api/practice/next', auth(cookie, json(drill)))
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

  const stats = (await (await app.request('/api/stats', auth(cookie))).json()) as {
    quietUntil: number
  }
  expect(stats.quietUntil).toBeGreaterThan(0)

  const off = (await (
    await app.request('/api/practice/quiet', auth(cookie, json({ enabled: false })))
  ).json()) as { quietUntil: number }
  expect(off.quietUntil).toBe(0)

  sqlite.close()
})

test('study preferences: readings can be hidden per user', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const nextReading = async () =>
    (
      (await (
        await app.request(
          '/api/practice/next',
          auth(cookie, json({ deckId, exerciseId: 'translate.back_to_front' })),
        )
      ).json()) as { instance: { data: { reading?: string } } }
    ).instance.data.reading

  expect(await nextReading()).toBeTruthy()

  const saved = (await (
    await app.request(
      '/api/settings',
      auth(cookie, { ...json({ study: { showZhuyin: false } }), method: 'PUT' }),
    )
  ).json()) as { study: { showZhuyin: boolean; disabledExercises: string[] } }
  expect(saved.study.showZhuyin).toBe(false)
  expect(await nextReading()).toBe('')

  const got = (await (await app.request('/api/settings', auth(cookie))).json()) as {
    study: { showZhuyin: boolean }
  }
  expect(got.study.showZhuyin).toBe(false)
  sqlite.close()
})

test('study preferences: disabled exercise kinds are skipped', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id

  const saved = (await (
    await app.request(
      '/api/settings',
      auth(cookie, {
        ...json({ study: { disabledExercises: ['type_listen', 'speak_word', 'multiple_choice'] } }),
        method: 'PUT',
      }),
    )
  ).json()) as { study: { disabledExercises: string[] } }
  expect([...saved.study.disabledExercises].sort()).toEqual([
    'multiple_choice',
    'speak_word',
    'type_listen',
  ])

  for (let i = 0; i < 30; i++) {
    const r = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance?: { exerciseId: string } }
    if (r.instance) expect(r.instance.exerciseId).not.toBe('multiple_choice')
  }

  const forced = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId, exerciseId: 'multiple_choice' })),
    )
  ).json()) as { instance: { exerciseId: string } }
  expect(forced.instance.exerciseId).not.toBe('multiple_choice')

  const junk = (await (
    await app.request(
      '/api/settings',
      auth(cookie, {
        ...json({ study: { disabledExercises: ['nope', 'introduce'] } }),
        method: 'PUT',
      }),
    )
  ).json()) as { study: { disabledExercises: string[] } }
  expect(junk.study.disabledExercises).toEqual([])
  sqlite.close()
})

test('the speaking drill is never served for a single word', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id

  for (let i = 0; i < 30; i++) {
    const r = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance?: { exerciseId: string } }
    if (r.instance) expect(r.instance.exerciseId).not.toBe('speak_word')
  }

  const forced = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId, exerciseId: 'speak_word' })),
    )
  ).json()) as { instance: { exerciseId: string } }
  expect(forced.instance.exerciseId).not.toBe('speak_word')
  sqlite.close()
})

test('active deck: the profile choice drives free practice', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const ja = decks.decks.find((d) => d.level === 'jafreq')!
  const jaCards = (await (await app.request(`/api/decks/${ja.id}/cards`, auth(cookie))).json()) as {
    cards: { id: string }[]
  }
  const jaIds = new Set(jaCards.cards.map((c) => c.id))

  const before = (await (await app.request('/api/settings', auth(cookie))).json()) as {
    study: { activeDeckId: string | null }
  }
  expect(before.study.activeDeckId).toBeNull()

  const saved = (await (
    await app.request(
      '/api/settings',
      auth(cookie, { ...json({ study: { activeDeckId: ja.id } }), method: 'PUT' }),
    )
  ).json()) as { study: { activeDeckId: string | null } }
  expect(saved.study.activeDeckId).toBe(ja.id)

  const next = (await (await app.request('/api/practice/next', auth(cookie, json({})))).json()) as {
    instance: { cardId: string } | null
  }
  expect(next.instance).toBeTruthy()
  expect(jaIds.has(next.instance!.cardId)).toBe(true)

  const got = (await (await app.request('/api/settings', auth(cookie))).json()) as {
    study: { activeDeckId: string | null }
  }
  expect(got.study.activeDeckId).toBe(ja.id)

  const bad = await app.request(
    '/api/settings',
    auth(cookie, { ...json({ study: { activeDeckId: 'nope' } }), method: 'PUT' }),
  )
  expect(bad.status).toBe(400)

  const cleared = (await (
    await app.request(
      '/api/settings',
      auth(cookie, { ...json({ study: { activeDeckId: '' } }), method: 'PUT' }),
    )
  ).json()) as { study: { activeDeckId: string | null } }
  expect(cleared.study.activeDeckId).toBeNull()
  sqlite.close()
})

test('practice: nothing due and no new words means done, never the same card again', async () => {
  const { app, db, sqlite } = makeApp()
  const res = await app.request(
    '/api/auth/register',
    json({ username: 'loop', password: 'password123' }),
  )
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const { user } = (await res.json()) as { user: { id: UserId } }
  createFixtureDecks(db, user.id)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id
  const cards = (await (await app.request(`/api/decks/${deckId}/cards`, auth(cookie))).json()) as {
    cards: { id: string }[]
  }

  const now = Date.now()
  for (const c of cards.cards) {
    upsertSrs(db, user.id, toCardId(c.id), {
      state: 'review',
      step: 0,
      stability: 5,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      intervalDays: 7,
      dueAt: now + 7 * 86_400_000,
      lastRating: 3,
      lastReviewAt: now - 86_400_000,
    })
  }

  const done = (await (
    await app.request('/api/practice/next', auth(cookie, json({ deckId })))
  ).json()) as { instance: unknown; done?: boolean }
  expect(done.done).toBe(true)
  expect(done.instance ?? null).toBeNull()
  sqlite.close()
})

test('practice keeps giving new words past the daily budget instead of stopping', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id

  await app.request(
    '/api/settings',
    auth(cookie, { ...json({ study: { newPerDay: 1 } }), method: 'PUT' }),
  )

  const next = async () =>
    (await (await app.request('/api/practice/next', auth(cookie, json({ deckId })))).json()) as {
      instance: { exerciseId: string; cardId: string } | null
      done?: boolean
    }
  const grade = async (exerciseId: string, cardId: string) =>
    app.request('/api/practice/grade', auth(cookie, json({ exerciseId, cardId, answer: '~' })))

  const taught = await next()
  expect(taught.instance!.exerciseId).toBe('introduce')
  await grade('introduce', taught.instance!.cardId)
  const drilled = await next()
  expect(drilled.instance!.cardId).toBe(taught.instance!.cardId)
  await grade(drilled.instance!.exerciseId, drilled.instance!.cardId)

  const again = await next()
  expect(again.done).toBeFalsy()
  expect(again.instance!.exerciseId).toBe('introduce')
  expect(again.instance!.cardId).not.toBe(taught.instance!.cardId)

  const stats = (await (await app.request('/api/srs/stats', auth(cookie))).json()) as {
    budget: { newRemaining: number }
  }
  expect(stats.budget.newRemaining).toBeGreaterThan(0)
  sqlite.close()
})

test('a grammar card is taught before it is drilled', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const { decks } = await getJson<{ decks: { id: string; level: string }[] }>(
    app,
    cookie,
    '/api/decks',
  )
  const deckId = decks.find((d) => d.level === 'zhfreq')!.id
  const created = await postJson<{ card: { id: string } }>(
    app,
    cookie,
    `/api/decks/${deckId}/cards`,
    {
      type: 'grammar',
      front: 'verb before object',
      back: '喝',
      payload: { prompt: '我___茶。', answer: '喝', rule: 'verb before object' },
    },
  )
  const served = await postJson<{
    instance: { exerciseId: string; data: { grammar?: unknown } }
  }>(app, cookie, '/api/practice/next', { deckId, cardId: created.card.id })
  expect(served.instance.exerciseId).toBe('introduce')
  expect(served.instance.data.grammar).toBeDefined()
  sqlite.close()
})

test('with no deck chosen, new words come round-robin across decks', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const { decks } = await getJson<{ decks: { id: string }[] }>(app, cookie, '/api/decks')
  const owner = new Map<string, string>()
  for (const deck of decks) {
    const { cards } = await getJson<{ cards: { id: string }[] }>(
      app,
      cookie,
      `/api/decks/${deck.id}/cards`,
    )
    for (const card of cards) owner.set(card.id, deck.id)
  }
  const grade = (exerciseId: string, cardId: string) =>
    postJson(app, cookie, '/api/practice/grade', { exerciseId, cardId, answer: '~' })
  const meet = async () => {
    const intro = await postJson<{ instance: { exerciseId: string; cardId: string } }>(
      app,
      cookie,
      '/api/practice/next',
      {},
    )
    await grade(intro.instance.exerciseId, intro.instance.cardId)
    const drill = await postJson<{ instance: { exerciseId: string; cardId: string } }>(
      app,
      cookie,
      '/api/practice/next',
      {},
    )
    await grade(drill.instance.exerciseId, drill.instance.cardId)
    return drill.instance.cardId
  }

  const served: string[] = []
  for (let i = 0; i < 4; i++) served.push(owner.get(await meet())!)
  expect(served[0]).toBe(served[2])
  expect(served[0]).not.toBe(served[1])
  expect(served[1]).not.toBe(served[2])
  expect(served[2]).not.toBe(served[3])
  sqlite.close()
})

test('a grade is refused for a drill the server did not hand out', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = await getJson<{ decks: { id: string }[] }>(app, cookie, '/api/decks')
  const deckId = decks.decks[0]!.id
  const cards = await getJson<{ cards: { id: string; back: string }[] }>(
    app,
    cookie,
    `/api/decks/${deckId}/cards`,
  )
  const [first, second] = cards.cards
  const issued = { deckId, cardId: first!.id, exerciseId: 'multiple_choice' }
  await postJson(app, cookie, '/api/practice/next', issued)

  const grade = (body: object) => app.request('/api/practice/grade', auth(cookie, json(body)))
  const other = { exerciseId: 'multiple_choice', cardId: second!.id, answer: second!.back }
  expect((await grade(other)).status).toBe(409)
  const swapped = { exerciseId: 'translate.front_to_back', cardId: first!.id, answer: first!.back }
  expect((await grade(swapped)).status).toBe(409)
  const real = { exerciseId: 'multiple_choice', cardId: first!.id, answer: first!.back }
  expect((await grade(real)).status).toBe(200)
  sqlite.close()
})

test('a multiple-choice answer never mixes in another language', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const user = listUsers(db)[0]!

  const zh = createDeck(db, user.id, { name: 'zh', sourceLang: 'en', targetLang: 'zh' })
  const zhCard = addCard(db, user.id, {
    deckId: zh.id,
    sourceLang: 'en',
    targetLang: 'zh',
    front: 'I',
    back: '我',
    readings: {},
    tags: [],
    payload: { template: 'vocab', step: 1 },
  })
  upsertSrs(db, user.id, zhCard.id, {
    state: 'review',
    step: 0,
    stability: 5,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    intervalDays: 7,
    dueAt: Date.now() + 7 * 86_400_000,
    lastRating: 3,
    lastReviewAt: Date.now() - 86_400_000,
  })

  const ko = createDeck(db, user.id, { name: 'ko', sourceLang: 'en', targetLang: 'ko' })
  const koCard = addCard(db, user.id, {
    deckId: ko.id,
    type: 'phrase',
    sourceLang: 'en',
    targetLang: 'ko',
    front: 'There are people.',
    back: '사람 있어요.',
    readings: {},
    tags: [],
    payload: {
      template: 'sentence',
      step: 1,
      tokens: ['사람', '있어요.'],
      gloss: 'There are people.',
    },
  })

  const next = await postJson<{ instance: { data: { choices: string[] } } }>(
    app,
    cookie,
    '/api/practice/next',
    { deckId: ko.id, cardId: koCard.id, exerciseId: 'multiple_choice' },
  )
  expect(next.instance.data.choices.some((c) => /[\u3400-\u9fff]/.test(c))).toBe(false)
  sqlite.close()
})
