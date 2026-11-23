import type { UserId } from './ids'
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
  seedStarterDecks(db, user.id)
  return cookie
}

type CardRow = { id: string; front: string; back: string }

function correctAnswer(
  instance: { exerciseId: string; data?: Record<string, unknown> },
  card: CardRow,
): string | string[] {
  if (instance.exerciseId === 'translate.back_to_front') return card.front
  if (instance.exerciseId === 'converse') return `我${card.back}`
  if (instance.exerciseId === 'sentence_build') {
    const tokens = instance.data?.tokens
    if (Array.isArray(tokens)) return tokens as string[]
  }
  return card.back
}

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
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const body = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    skills: { id: string; level: number; effect: { value: number }; actions: unknown[] }[]
    items: { id: string }[]
    inventory: { itemId: string; count: number }[]
    equipment: unknown[]
  }
  expect(body.skills.length).toBeGreaterThanOrEqual(20)
  const mining = body.skills.find((s) => s.id === 'mining')
  expect(mining?.level).toBe(1)
  expect(mining?.actions.filter((a) => (a as { level: number }).level === 1).length).toBe(7)
  expect(body.skills.every((s) => s.actions.length > 0)).toBe(true)
  expect(body.items.length).toBeGreaterThan(20)
  expect(body.inventory.length).toBe(body.items.length)
  expect(Array.isArray(body.equipment)).toBe(true)
  sqlite.close()
})

interface Instance {
  exerciseId: string
  cardId: string
  data?: Record<string, unknown>
}

interface RigView {
  completions: number
  active: boolean
  intervalSec: number
  runSec: number
  maxRunSec: number
  runFullAtCompletions: number
  runProgress: number
  maxed: boolean
}

interface Graded {
  result: { correct: boolean }
  skill: { skillId: string; xp: number; gained: unknown[]; idle: RigView | null }
  stats: { xp: number }
}

interface Board {
  inventory: { itemId: string; count: number }[]
  skills: { id: string; xp: number; actions: { id: string; idle: unknown }[] }[]
}

async function getJson<T>(app: App, cookie: string, path: string): Promise<T> {
  return (await (await app.request(path, auth(cookie))).json()) as T
}

async function postJson<T>(app: App, cookie: string, path: string, body: unknown): Promise<T> {
  return (await (await app.request(path, auth(cookie, json(body)))).json()) as T
}

async function clearTeachStep(app: App, cookie: string, instance: Instance, actionId: string) {
  if (instance.exerciseId !== 'introduce') return
  await postJson(app, cookie, '/api/practice/grade', {
    exerciseId: 'introduce',
    cardId: instance.cardId,
    answer: 'ok',
    actionId,
  })
}

async function gradeDrill(
  app: App,
  cookie: string,
  instance: Instance,
  answer: string | string[],
  actionId: string,
): Promise<Graded> {
  return postJson<Graded>(app, cookie, '/api/practice/grade', {
    exerciseId: instance.exerciseId,
    cardId: instance.cardId,
    answer,
    actionId,
  })
}

function expectTrainingAwarded(g: Graded) {
  expect(g.result.correct).toBe(true)
  expect(g.skill.skillId).toBe('mining')
  expect(g.skill.xp).toBeGreaterThan(0)
  expect(g.stats.xp).toBeGreaterThan(0)
  expect(g.skill.idle?.completions).toBe(1)
  expect(g.skill.idle?.active).toBe(true)
  expect(g.skill.idle?.runSec).toBe(600)
  expect(g.skill.idle?.intervalSec).toBeGreaterThan(2)
  expect(g.skill.idle?.maxRunSec).toBe(3 * 60 * 60)
  expect(g.skill.idle?.runFullAtCompletions).toBe(50)
  expect(g.skill.idle?.runProgress).toBeCloseTo(1 / 50, 6)
  expect(g.skill.idle?.maxed).toBe(false)
}

function expectBoardCarriesRig(board: Board) {
  expect(board.inventory.find((i) => i.itemId === 'copper_ore')?.count).toBeGreaterThanOrEqual(1)
  expect(board.skills.find((s) => s.id === 'mining')?.xp).toBeGreaterThan(0)
  const mine = board.skills
    .find((s) => s.id === 'mining')!
    .actions.find((a) => a.id === 'mine-copper')
  expect(mine?.idle).toBeTruthy()
}

test('training an action awards skill XP and materials', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const first = await postJson<{ instance: Instance }>(app, cookie, '/api/practice/next', {
    actionId: 'mine-copper',
  })
  await clearTeachStep(app, cookie, first.instance, 'mine-copper')

  const next = await postJson<{ instance: Instance; action: { skillId: string } }>(
    app,
    cookie,
    '/api/practice/next',
    { actionId: 'mine-copper' },
  )
  expect(next.action.skillId).toBe('mining')
  const card = (await cardIndex(app, cookie)).get(next.instance.cardId)!
  const graded = await gradeDrill(
    app,
    cookie,
    next.instance,
    correctAnswer(next.instance, card),
    'mine-copper',
  )
  expectTrainingAwarded(graded)
  expectBoardCarriesRig(await getJson<Board>(app, cookie, '/api/skills'))
  sqlite.close()
})

test('actions are gated by unlocks, materials and equipment', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  const locked = await app.request(
    '/api/practice/next',
    auth(cookie, json({ actionId: 'mine-iron' })),
  )
  expect(locked.status).toBe(403)

  const noWeapon = await app.request(
    '/api/practice/next',
    auth(cookie, json({ actionId: 'train-attack' })),
  )
  expect(noWeapon.status).toBe(403)
  const body = (await noWeapon.json()) as { equipMissing?: { tag: string } }
  expect(body.equipMissing?.tag).toBe('melee')

  const noMats = await app.request(
    '/api/practice/next',
    auth(cookie, json({ actionId: 'brew-attack' })),
  )
  expect(noMats.status).toBe(409)
  sqlite.close()
})

test('GET /api/skills/:id returns one profession with its talent roadmap', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const body = (await (await app.request('/api/skills/mining', auth(cookie))).json()) as {
    skill: {
      id: string
      name: string
      actions: unknown[]
      talent: {
        owned: unknown[]
        nextMilestone: number | null
        pendingChoice: boolean
        synergy: {
          target: string
          name: string
          label: string
          taken: number[]
        }
        mastery: { milestones: number[]; pending: unknown[]; owned: unknown[] }
      }
    }
    items: unknown[]
    sources: Record<string, { skillId: string; actionId: string }>
    fedBy: {
      skillId: string
      name: string
      label: string
      taken: number[]
    }[]
  }
  expect(body.skill.id).toBe('mining')
  expect(body.skill.name).toBe('Mining')
  expect(body.skill.actions.length).toBeGreaterThan(0)
  expect(body.skill.talent.owned).toEqual([])
  expect(body.skill.talent.nextMilestone).toBe(10)
  expect(body.skill.talent.pendingChoice).toBe(false)
  expect(body.skill.talent.synergy).toEqual({
    target: 'smithing',
    name: 'Smithing',
    label: 'Ore Sense',
    taken: [],
  })
  expect(body.skill.talent.mastery.milestones).toEqual([50, 100])
  expect(body.skill.talent.mastery.pending).toEqual([])
  expect(body.items.length).toBeGreaterThan(20)
  expect(body.sources.copper_ore).toEqual({ skillId: 'mining', actionId: 'mine-copper' })
  expect(body.fedBy).toEqual([
    { skillId: 'smithing', name: 'Smithing', label: 'Deep Veins', taken: [] },
  ])

  const missing = await app.request('/api/skills/nope', auth(cookie))
  expect(missing.status).toBe(404)
  sqlite.close()
})

test('talent + equip endpoints validate input', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

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
  expect(missingItem.status).toBe(400)
  sqlite.close()
})

test('GET /api/skills/gear is the gear screen, not a profession page', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const res = await app.request('/api/skills/gear', auth(cookie))
  expect(res.status).toBe(200)
  expect(Object.keys((await res.json()) as object)).toContain('equipment')
  sqlite.close()
})

test('GET /api/settings never returns the stored OpenRouter key', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)
  const put: RequestInit = { ...json({ key: 'sk-or-SECRET123' }), method: 'PUT' }
  const saved = await app.request('/api/settings/openrouter-key', auth(cookie, put))
  expect(saved.status).toBe(200)
  const text = await (await app.request('/api/settings', auth(cookie))).text()
  expect(text).not.toContain('SECRET123')
  expect(text).not.toContain('openrouter_key')
  sqlite.close()
})
