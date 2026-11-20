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
  // Decks are no longer pre-seeded; tests drill the curated fixture decks.
  const { user } = (await res.json()) as { user: { id: string } }
  seedStarterDecks(db, user.id)
  return cookie
}

type CardRow = { id: string; front: string; back: string }

/**
 * The correct answer for whatever drill the server picked. `pickNextExercise`
 * randomises among the eligible exercise kinds, so the answer has to be derived
 * from the instance rather than assumed to be the card's front/back.
 */
function correctAnswer(
  instance: { exerciseId: string; data?: Record<string, unknown> },
  card: CardRow,
): string | string[] {
  if (instance.exerciseId === 'translate.back_to_front') return card.front
  // A sentence that *uses* the word (the bare word alone is not a sentence).
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
  // the profession level is the mean of its actions' levels: Mining has seven, all 1
  const mining = body.skills.find((s) => s.id === 'mining')
  expect(mining?.level).toBe(1)
  expect(mining?.actions.filter((a) => (a as { level: number }).level === 1).length).toBe(7)
  expect(body.skills.every((s) => s.actions.length > 0)).toBe(true)
  expect(body.items.length).toBeGreaterThan(20)
  expect(body.inventory.length).toBe(body.items.length)
  expect(Array.isArray(body.equipment)).toBe(true)
  sqlite.close()
})

test('training an action awards skill XP and materials', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

  // The first exposure to a card is a "teach" step, not a graded drill: clear it
  // so the next fetch hands back the action's exercise.
  const first = (await (
    await app.request('/api/practice/next', auth(cookie, json({ actionId: 'mine-copper' })))
  ).json()) as { instance: { exerciseId: string; cardId: string } }
  if (first.instance.exerciseId === 'introduce') {
    await app.request(
      '/api/practice/grade',
      auth(
        cookie,
        json({
          exerciseId: 'introduce',
          cardId: first.instance.cardId,
          answer: 'ok',
          actionId: 'mine-copper',
        }),
      ),
    )
  }

  const next = (await (
    await app.request('/api/practice/next', auth(cookie, json({ actionId: 'mine-copper' })))
  ).json()) as {
    instance: { exerciseId: string; cardId: string; data?: Record<string, unknown> }
    action: { skillId: string }
  }
  expect(next.action.skillId).toBe('mining')

  const cards = await cardIndex(app, cookie)
  const card = cards.get(next.instance.cardId)!
  const answer = correctAnswer(next.instance, card)

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
    skill: {
      skillId: string
      xp: number
      gained: unknown[]
      idle: { completions: number; active: boolean; intervalSec: number; runSec: number } | null
    }
    stats: { xp: number }
  }
  expect(graded.result.correct).toBe(true)
  expect(graded.skill.skillId).toBe('mining')
  expect(graded.skill.xp).toBeGreaterThan(0)
  expect(graded.stats.xp).toBeGreaterThan(0)
  // the drill powered a rig (docs/DESIGN.md §13.5.1): one completion, a 10-minute run
  expect(graded.skill.idle?.completions).toBe(1)
  expect(graded.skill.idle?.active).toBe(true)
  expect(graded.skill.idle?.runSec).toBe(600)
  expect(graded.skill.idle?.intervalSec).toBeGreaterThan(2)

  const skills = (await (await app.request('/api/skills', auth(cookie))).json()) as {
    inventory: { itemId: string; count: number }[]
    skills: { id: string; xp: number; actions: { id: string; idle: unknown }[] }[]
  }
  expect(skills.inventory.find((i) => i.itemId === 'copper_ore')?.count).toBeGreaterThanOrEqual(1)
  expect(skills.skills.find((s) => s.id === 'mining')?.xp).toBeGreaterThan(0)
  // the board carries every action's rig, so the client can tick it locally
  const mine = skills.skills
    .find((s) => s.id === 'mining')!
    .actions.find((a) => a.id === 'mine-copper')
  expect(mine?.idle).toBeTruthy()
  sqlite.close()
})

test('actions are gated by unlocks, materials and equipment', async () => {
  const { app, db, sqlite } = makeApp()
  const cookie = await signup(app, db)

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
  // the web: Mining feeds Smithing, and Smithing gates Mining's capstone
  expect(body.skill.talent.synergy).toEqual({
    target: 'smithing',
    name: 'Smithing',
    label: 'Ore Sense',
    taken: [],
  })
  expect(body.skill.talent.mastery.milestones).toEqual([50, 100])
  expect(body.skill.talent.mastery.pending).toEqual([])
  expect(body.items.length).toBeGreaterThan(20)
  // a material's "needs" cost links to the action that supplies it
  expect(body.sources.copper_ore).toEqual({ skillId: 'mining', actionId: 'mine-copper' })
  // the reverse edge: Smithing's synergy talent feeds Mining
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
  expect(missingItem.status).toBe(400) // not in the bank yet
  sqlite.close()
})
