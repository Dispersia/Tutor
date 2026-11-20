import { expect, test } from 'bun:test'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import type { Db } from './db/client'
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

async function signup(app: App, db: Db, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  // Decks are no longer pre-seeded; tests drill the curated fixture decks.
  const { user } = (await res.json()) as { user: { id: string } }
  seedStarterDecks(db, user.id)
  return cookie
}

const auth = (cookie: string, extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { ...(extra.headers ?? {}), cookie },
})

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

test('templates: the reusable card templates are exposed', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const res = await app.request('/api/templates', auth(cookie))
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    templates: { kind: string; exercises: string[]; fields: unknown[] }[]
  }
  expect(body.templates.map((t) => t.kind)).toEqual([
    'vocab',
    'listening',
    'spoken',
    'sentence',
    'grammar',
  ])
  expect(body.templates.every((t) => t.exercises.length > 0 && t.fields.length > 0)).toBe(true)
  sqlite.close()
})

test('practice: next -> grade -> xp, and exercise catalog', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const cat = (await (await app.request('/api/exercises', auth(cookie))).json()) as {
    exercises: { id: string }[]
  }
  expect(cat.exercises.length).toBeGreaterThanOrEqual(7)

  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string; level: string }[]
  }
  const deckId = decks.decks.find((d) => d.level === 'zhfreq')!.id

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
  const { app, db, sqlite } = makeApp()
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

  // A retry is graded like any other take (score + tips), but it must not touch
  // XP or the SRS schedule — only the learner's first attempt counts.
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

  // Zhuyin shows by default.
  expect(await nextReading()).toBeTruthy()

  // Turning it off hides it from the prompt.
  const saved = (await (
    await app.request(
      '/api/settings',
      auth(cookie, { ...json({ study: { showZhuyin: false } }), method: 'PUT' }),
    )
  ).json()) as { study: { showZhuyin: boolean; disabledExercises: string[] } }
  expect(saved.study.showZhuyin).toBe(false)
  expect(await nextReading()).toBe('')

  // GET reflects the stored preference.
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

  // Auto-picked drills never come up as a disabled kind.
  for (let i = 0; i < 30; i++) {
    const r = (await (
      await app.request('/api/practice/next', auth(cookie, json({ deckId })))
    ).json()) as { instance?: { exerciseId: string } }
    if (r.instance) expect(r.instance.exerciseId).not.toBe('multiple_choice')
  }

  // Forcing a disabled kind swaps in one that is allowed.
  const forced = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId, exerciseId: 'multiple_choice' })),
    )
  ).json()) as { instance: { exerciseId: string } }
  expect(forced.instance.exerciseId).not.toBe('multiple_choice')

  // Unknown ids (and the first-exposure teach step) are ignored by validation.
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
