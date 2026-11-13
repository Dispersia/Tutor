import type { Learner } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv } from '../context'
import {
  addReview,
  addXp,
  getCard,
  getRoles,
  getStats,
  levelForXp,
  otherBacks,
  pickCard,
} from '../db/repo'
import { exerciseCatalog, registry } from '../exercises'
import { OpenRouter } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { seedStarterDecks } from '../seed/service'

function learnerOf(user: {
  id: string
  nativeLang: string
  targetLang: string | null
  level: string | null
}): Learner {
  return {
    id: user.id,
    nativeLang: user.nativeLang,
    targetLang: user.targetLang ?? 'zh',
    level: user.level ?? 'hsk1',
  }
}

/** Builds the optional LLM judge for this user (absent when no key is set). */
async function judgeFor(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return undefined
  const model = getRoles(deps.db, user.id, deps.defaults).judge
  const or = new OpenRouter(key, deps.or.baseUrl)
  return async (prompt: string, schema: object): Promise<unknown> => {
    const { json } = await or.chatJSON({
      model,
      schema,
      schemaName: 'grade',
      messages: [
        {
          role: 'system',
          content:
            'You are a strict but encouraging language tutor. Reply with only the requested JSON.',
        },
        { role: 'user', content: prompt },
      ],
    })
    return json
  }
}

export function registerPractice(app: App) {
  app.get('/api/exercises', (c) => c.json({ exercises: exerciseCatalog() }))

  app.post('/api/practice/next', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as { deckId?: string; exerciseId?: string }
    seedStarterDecks(deps.db, user.id)

    const card = pickCard(deps.db, user.id, body.deckId)
    if (!card) return c.json({ error: 'no cards in this deck' }, 404)

    const learner = learnerOf(user)
    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
      judge: await judgeFor(c),
    }
    const eligible = body.exerciseId
      ? [registry.get(body.exerciseId)].filter((d) => d !== undefined)
      : registry.forCard(card, learner)
    const defs = eligible.length ? eligible : registry.forCard(card, learner)
    const def = defs[Math.floor(Math.random() * defs.length)]
    if (!def) return c.json({ error: 'no exercise available' }, 500)

    const instance = await def.generate(ctx)
    return c.json({ instance })
  })

  app.post('/api/practice/grade', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      exerciseId?: string
      cardId?: string
      answer?: unknown
      latencyMs?: number
    }
    const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
    if (!def) return c.json({ error: 'exercise not found' }, 404)

    const learner = learnerOf(user)
    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
      judge: await judgeFor(c),
    }
    const instance = await def.generate(ctx)
    const result = await def.grade(ctx, instance, body.answer)
    const xp = def.xp(result, instance)

    addReview(deps.db, {
      cardId: card.id,
      userId: user.id,
      exerciseId: def.id,
      score: result.score,
      latencyMs: body.latencyMs,
      detail: result.detail,
    })
    addXp(deps.db, user.id, xp, 'review', def.id)

    const s = getStats(deps.db, user.id)
    return c.json({
      result: { ...result, xp },
      stats: { xp: s.xpTotal, level: levelForXp(s.xpTotal) },
    })
  })
}
