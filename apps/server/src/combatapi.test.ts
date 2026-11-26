import { toCardId, type UserId } from './ids'
import { expect, test } from 'bun:test'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import type { Db } from './db/client'
import {
  dailyReviewCounts,
  getSrs,
  listCards,
  listSrsReviews,
  listUsers,
  upsertSrs,
} from './db/repo'
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
  const { user } = (await res.json()) as { user: { id: UserId } }
  createFixtureDecks(db, user.id)
  const now = Date.now()
  for (const c of listCards(db, user.id)) {
    upsertSrs(db, user.id, c.id, {
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
  }
  return cookie
}

type CardRow = { id: string; front: string; back: string }
async function cardIndex(app: App, cookie: string) {
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string }[]
  }
  const out = new Map<string, CardRow>()
  for (const d of decks.decks) {
    const cards = (await (await app.request(`/api/decks/${d.id}/cards`, auth(cookie))).json()) as {
      cards: CardRow[]
    }
    for (const c of cards.cards) out.set(c.id, c)
  }
  return out
}

type Instance = { exerciseId: string; cardId: string; data?: Record<string, unknown> }

function correctAnswer(instance: Instance, card: CardRow): string | string[] {
  if (instance.exerciseId === 'translate.back_to_front') return card.front
  if (instance.exerciseId === 'converse') return `我${card.back}`
  if (instance.exerciseId === 'sentence_build') {
    const tokens = instance.data?.tokens
    if (Array.isArray(tokens)) return tokens as string[]
  }
  return card.back
}

test('GET /api/combat lists monsters, player stats and any encounter', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const body = (await (await app.request('/api/combat', auth(cookie))).json()) as {
    monsters: { id: string; level: number }[]
    player: { maxHp: number; armour: number; weaponPower: number }
    encounter: unknown
  }
  expect(body.monsters.length).toBe(6)
  expect(body.player.maxHp).toBeGreaterThan(0)
  expect(body.player.weaponPower).toBe(0)
  expect(body.encounter).toBeNull()
  sqlite.close()
})

test('starting a fight with no review cards is refused', async () => {
  const { app, db, sqlite } = makeApp()
  const res = await app.request(
    '/api/auth/register',
    json({ username: 'fresh', password: 'password123' }),
  )
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const { user } = (await res.json()) as { user: { id: UserId } }
  createFixtureDecks(db, user.id)

  const start = await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  expect(start.status).toBe(409)
  const body = (await (await app.request('/api/combat', auth(cookie))).json()) as {
    reviewCount: number
  }
  expect(body.reviewCount).toBe(0)
  sqlite.close()
})

test('starting an unknown monster is refused', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const res = await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'nope' })))
  expect(res.status).toBe(404)
  sqlite.close()
})

test('fight a slime: hits land, a kill drops materials', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as {
    encounter: { monsterHp: number; playerHp: number }
    instance: Instance
  }
  expect(start.encounter.monsterHp).toBe(15)
  expect(start.instance).toBeTruthy()

  const cards = await cardIndex(app, cookie)
  let instance = start.instance
  let outcome = 'ongoing'
  let lastHit: { damage: number; drops: { item: string }[] } | null = null

  for (let i = 0; i < 10 && outcome === 'ongoing'; i++) {
    const card = cards.get(instance.cardId)!
    const answer = correctAnswer(instance, card)
    const res = (await (
      await app.request(
        '/api/combat/hit',
        auth(cookie, json({ exerciseId: instance.exerciseId, cardId: instance.cardId, answer })),
      )
    ).json()) as {
      hit: { damage: number; outcome: string; drops: { item: string }[] }
      encounter: { monsterHp: number } | null
      instance: Instance | null
    }
    outcome = res.hit.outcome
    lastHit = res.hit
    if (outcome === 'ongoing' && res.instance) instance = res.instance
  }

  expect(outcome).toBe('won')
  expect(lastHit!.damage).toBeGreaterThan(0)
  expect(lastHit!.drops.map((d) => d.item)).toContain('bones')

  const skills = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    inventory: { itemId: string; count: number }[]
  }
  expect(skills.inventory.find((i) => i.itemId === 'bones')?.count).toBeGreaterThanOrEqual(1)
  sqlite.close()
})

test('a missed drill lets the monster hit back', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { encounter: { playerHp: number }; instance: Instance }
  expect(start.encounter.playerHp).toBeGreaterThan(0)

  const res = (await (
    await app.request(
      '/api/combat/hit',
      auth(
        cookie,
        json({
          exerciseId: start.instance.exerciseId,
          cardId: start.instance.cardId,
          answer: 'definitely-wrong',
        }),
      ),
    )
  ).json()) as {
    result: { correct: boolean }
    hit: {
      correct: boolean
      playerDamage: number
      playerHp: number
    }
    encounter: { playerHp: number } | null
  }

  expect(res.result.correct).toBe(false)
  expect(res.hit.correct).toBe(false)
  expect(res.hit.playerDamage).toBeGreaterThan(0)
  expect(res.hit.playerHp).toBeLessThan(start.encounter.playerHp)
  expect(res.encounter?.playerHp).toBe(res.hit.playerHp)
  sqlite.close()
})

test('a correct drill still takes the monster’s blow', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { encounter: { playerHp: number }; instance: Instance }
  const cards = await cardIndex(app, cookie)
  const card = cards.get(start.instance.cardId)!
  const answer = correctAnswer(start.instance, card)

  const res = (await (
    await app.request(
      '/api/combat/hit',
      auth(
        cookie,
        json({
          exerciseId: start.instance.exerciseId,
          cardId: start.instance.cardId,
          answer,
        }),
      ),
    )
  ).json()) as {
    result: { correct: boolean }
    hit: { playerDamage: number; playerHp: number }
    encounter: { playerHp: number } | null
  }

  expect(res.result.correct).toBe(true)
  expect(res.hit.playerDamage).toBeGreaterThan(0)
  expect(res.hit.playerHp).toBeLessThan(start.encounter.playerHp)
  expect(res.encounter?.playerHp).toBe(res.hit.playerHp)
  sqlite.close()
})

test('a timed-out drill is a miss even when the answer is empty', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { encounter: { playerHp: number }; instance: Instance }

  const res = (await (
    await app.request(
      '/api/combat/hit',
      auth(
        cookie,
        json({
          exerciseId: start.instance.exerciseId,
          cardId: start.instance.cardId,
          answer: '',
          timedOut: true,
        }),
      ),
    )
  ).json()) as {
    result: { correct: boolean; score: number; feedback?: string }
    hit: { correct: boolean; playerDamage: number; playerHp: number }
    encounter: { playerHp: number } | null
  }

  expect(res.result.correct).toBe(false)
  expect(res.result.score).toBe(0)
  expect(res.result.feedback).toContain('Out of time')
  expect(res.hit.correct).toBe(false)
  expect(res.hit.playerDamage).toBeGreaterThan(0)
  expect(res.hit.playerHp).toBeLessThan(start.encounter.playerHp)
  expect(res.encounter?.playerHp).toBe(res.hit.playerHp)
  sqlite.close()
})

test('hitting with no active encounter is a conflict', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const res = await app.request(
    '/api/combat/hit',
    auth(cookie, json({ exerciseId: 'multiple_choice', cardId: 'nope', answer: 'x' })),
  )
  expect([404, 409]).toContain(res.status)
  sqlite.close()
})

test('reloading mid-fight returns a fresh drill to resume', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { instance: Instance }
  expect(start.instance).toBeTruthy()

  const body = (await (await app.request('/api/combat', auth(cookie))).json()) as {
    encounter: unknown
    instance: Instance | null
  }
  expect(body.encounter).not.toBeNull()
  expect(body.instance?.exerciseId).toBeTruthy()
  expect(body.instance?.cardId).toBeTruthy()
  sqlite.close()
})

test('leaving a fight clears the encounter with no rewards', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  const before = (await (await app.request('/api/combat', auth(cookie))).json()) as {
    encounter: unknown
  }
  expect(before.encounter).not.toBeNull()

  const leave = (await (
    await app.request('/api/combat/leave', auth(cookie, { method: 'POST' }))
  ).json()) as { encounter: unknown }
  expect(leave.encounter).toBeNull()

  const after = (await (await app.request('/api/combat', auth(cookie))).json()) as {
    encounter: unknown
    instance: unknown
  }
  expect(after.encounter).toBeNull()
  expect(after.instance).toBeNull()

  const skills = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    inventory: { itemId: string; count: number }[]
  }
  expect(skills.inventory.find((i) => i.itemId === 'bones')?.count ?? 0).toBe(0)
  sqlite.close()
})

test('a combat hit writes no SRS row and no review row', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const userId = listUsers(db)[0]!.id

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { instance: Instance }
  const cardId = toCardId(start.instance.cardId)
  const before = getSrs(db, userId, cardId)

  const res = await app.request(
    '/api/combat/hit',
    auth(
      cookie,
      json({
        exerciseId: start.instance.exerciseId,
        cardId: start.instance.cardId,
        answer: 'definitely-wrong',
      }),
    ),
  )
  expect(res.status).toBe(200)

  expect(dailyReviewCounts(db, userId, 0).reviews).toBe(0)
  expect(listSrsReviews(db, userId).length).toBe(0)
  expect(getSrs(db, userId, cardId)?.dueAt).toBe(before?.dueAt)
  sqlite.close()
})

test('a combat drill only ever serves cards from the selected deck', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; level: string }[]
  }
  const japanese = decks.decks.find((d) => d.level === 'jafreq')!
  await app.request(
    '/api/settings',
    auth(cookie, { ...json({ study: { activeDeckId: japanese.id } }), method: 'PUT' }),
  )
  const cards = (await (
    await app.request(`/api/decks/${japanese.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string }[] }
  const inDeck = new Set(cards.cards.map((c) => c.id))

  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { instance: Instance }
  expect(inDeck.has(start.instance.cardId)).toBe(true)

  for (let i = 0; i < 6; i++) {
    const board = (await (await app.request('/api/combat', auth(cookie))).json()) as {
      instance: Instance | null
    }
    expect(board.instance).toBeTruthy()
    expect(inDeck.has(board.instance!.cardId)).toBe(true)
  }
  sqlite.close()
})

test('a combat hit is refused when the exercise does not fit the card', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { instance: Instance }

  const res = await app.request(
    '/api/combat/hit',
    auth(cookie, json({ exerciseId: 'grammar_cloze', cardId: start.instance.cardId, answer: 'x' })),
  )
  expect(res.status).toBe(400)
  sqlite.close()
})

test('a combat hit is refused for a drill the member was not given', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const start = (await (
    await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'slime' })))
  ).json()) as { instance: Instance }

  const res = await app.request(
    '/api/combat/hit',
    auth(cookie, json({ exerciseId: 'introduce', cardId: start.instance.cardId, answer: 'x' })),
  )
  expect(res.status).toBe(409)
  sqlite.close()
})
