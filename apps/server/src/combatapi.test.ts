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
  return { app, sqlite }
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

type Instance = { exerciseId: string; cardId: string }

test('GET /api/combat lists monsters, player stats and any encounter', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const body = (await (await app.request('/api/combat', auth(cookie))).json()) as {
    monsters: { id: string; unlocked: boolean }[]
    player: { maxHp: number; armour: number; weaponPower: number }
    encounter: unknown
  }
  expect(body.monsters.length).toBe(6)
  expect(body.player.maxHp).toBeGreaterThan(0)
  expect(body.player.weaponPower).toBe(0)
  expect(body.encounter).toBeNull()
  sqlite.close()
})

test('starting a gated monster is refused', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const res = await app.request('/api/combat/start', auth(cookie, json({ monsterId: 'dragon' })))
  expect(res.status).toBe(403)
  sqlite.close()
})

test('fight a slime: hits land, a kill drops materials', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

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
    const answer = instance.exerciseId === 'translate.back_to_front' ? card.front : card.back
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

test('hitting with no active encounter is a conflict', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const res = await app.request(
    '/api/combat/hit',
    auth(cookie, json({ exerciseId: 'multiple_choice', cardId: 'nope', answer: 'x' })),
  )
  expect([404, 409]).toContain(res.status)
  sqlite.close()
})
