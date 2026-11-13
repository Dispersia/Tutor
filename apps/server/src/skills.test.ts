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

type CardRow = { id: string; front: string; back: string }

async function cardIndex(app: App, cookie: string): Promise<Map<string, CardRow>> {
  const decks = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { id: string; name: string }[]
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

test('GET /api/skills returns the profession board', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const body = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    skills: { id: string; level: number; effect: { value: number }; actions: unknown[] }[]
    items: { id: string }[]
    inventory: { itemId: string; count: number }[]
    equipment: unknown[]
  }
  expect(body.skills.length).toBeGreaterThanOrEqual(20)
  expect(body.skills.find((s) => s.id === 'mining')?.level).toBe(1)
  expect(body.skills.every((s) => s.actions.length > 0)).toBe(true)
  expect(body.items.length).toBeGreaterThan(20)
  expect(body.inventory.length).toBe(body.items.length)
  expect(Array.isArray(body.equipment)).toBe(true)
  sqlite.close()
})

test('training an action awards skill XP and materials', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ actionId: 'mine-copper' })))
  ).json()) as { instance: { exerciseId: string; cardId: string }; action: { skillId: string } }
  expect(next.action.skillId).toBe('mining')

  const cards = await cardIndex(app, cookie)
  const card = cards.get(next.instance.cardId)!
  const answer = next.instance.exerciseId === 'translate.back_to_front' ? card.front : card.back

  const graded = (await (
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({
          exerciseId: next.instance.exerciseId,
          cardId: next.instance.cardId,
          answer,
          actionId: 'mine-copper',
        }),
      ),
    )
  ).json()) as {
    result: { correct: boolean }
    skill: { skillId: string; xp: number; gained: unknown[] }
    stats: { xp: number }
  }
  expect(graded.result.correct).toBe(true)
  expect(graded.skill.skillId).toBe('mining')
  expect(graded.skill.xp).toBeGreaterThan(0)
  expect(graded.stats.xp).toBeGreaterThan(0)

  const skills = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    inventory: { itemId: string; count: number }[]
    skills: { id: string; xp: number }[]
  }
  expect(skills.inventory.find((i) => i.itemId === 'copper_ore')?.count).toBeGreaterThanOrEqual(1)
  expect(skills.skills.find((s) => s.id === 'mining')?.xp).toBeGreaterThan(0)
  sqlite.close()
})

test('actions are gated by unlocks, materials and equipment', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

  // locked: mine-iron needs Mining 5
  const locked = await app.request(
    '/api/practice/next',
    auth(cookie, json({ actionId: 'mine-iron' })),
  )
  expect(locked.status).toBe(403)

  // needs a melee weapon equipped
  const noWeapon = await app.request(
    '/api/practice/next',
    auth(cookie, json({ actionId: 'train-attack' })),
  )
  expect(noWeapon.status).toBe(403)
  const body = (await noWeapon.json()) as { equipMissing?: { tag: string } }
  expect(body.equipMissing?.tag).toBe('melee')

  // artisan action needs materials
  const noMats = await app.request(
    '/api/practice/next',
    auth(cookie, json({ actionId: 'brew-attack' })),
  )
  expect(noMats.status).toBe(409)
  sqlite.close()
})

test('talent + equip endpoints validate input', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)

  const bad = await app.request('/api/skills/talents', auth(cookie, json({ talentId: 'nope' })))
  expect(bad.status).toBe(400)

  const notEquippable = await app.request(
    '/api/skills/equip',
    auth(cookie, json({ itemId: 'copper_ore' })),
  )
  expect(notEquippable.status).toBe(400)

  const missingItem = await app.request(
    '/api/skills/equip',
    auth(cookie, json({ itemId: 'bronze_sword' })),
  )
  expect(missingItem.status).toBe(400) // not in the bank yet
  sqlite.close()
})
