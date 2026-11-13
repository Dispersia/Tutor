import type { Card, ExerciseDef, Learner } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv } from '../context'
import {
  addReview,
  getCard,
  getRoles,
  lastExerciseUse,
  listDecks,
  otherBacks,
  pickCard,
} from '../db/repo'
import { exerciseCatalog, registry } from '../exercises'
import {
  actionState,
  awardSkillXp,
  awardXp,
  consumeItems,
  grantItems,
  recordActivity,
  summary,
} from '../game/service'
import { ACTION_BY_ID } from '../game/skills'
import { OpenRouter } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { makeAssessor, type AssessFn } from '../pronunciation/assess'
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

/** "The next drill": the eligible exercise you've trained least recently. */
export function pickNextExercise(
  db: Parameters<typeof lastExerciseUse>[0],
  userId: string,
  card: Card,
  learner: Learner,
): ExerciseDef<unknown> | undefined {
  const eligible = registry.forCard(card, learner)
  if (eligible.length <= 1) return eligible[0]
  const lastUse = lastExerciseUse(db, userId)
  const oldest = Math.min(...eligible.map((d) => lastUse.get(d.id) ?? 0))
  const ties = eligible.filter((d) => (lastUse.get(d.id) ?? 0) === oldest)
  return ties[Math.floor(Math.random() * ties.length)]
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

/** Applies profession XP + the material economy for a completed action. */
function settleAction(
  deps: AppEnv['Variables']['deps'],
  userId: string,
  actionId: string | undefined,
  result: { correct: boolean; score: number },
) {
  const action = actionId ? ACTION_BY_ID.get(actionId) : undefined
  if (!action) return null
  const minScore = action.minScore ?? 70
  const success = result.correct && result.score >= minScore
  if (!success) {
    return {
      skillId: action.skillId,
      xp: 0,
      leveledUp: false,
      gained: [],
      consumed: [],
      grantedTalents: [],
    }
  }
  const award = awardSkillXp(deps.db, deps.events, userId, action.skillId, action.xp)
  const produces = action.produces ?? []
  const consumes = action.consumes ?? []
  grantItems(deps.db, deps.events, userId, action.skillId, produces)
  consumeItems(deps.db, deps.events, userId, consumes)
  return {
    skillId: award.skillId,
    xp: award.xp,
    level: award.level,
    leveledUp: award.leveledUp,
    gained: produces,
    consumed: consumes,
    grantedTalents: award.grantedTalents,
  }
}

export function registerPractice(app: App) {
  app.get('/api/exercises', (c) => c.json({ exercises: exerciseCatalog() }))

  app.post('/api/practice/next', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      deckId?: string
      exerciseId?: string
      actionId?: string
    }
    seedStarterDecks(deps.db, user.id)

    const action = body.actionId ? ACTION_BY_ID.get(body.actionId) : undefined
    if (body.actionId && !action) return c.json({ error: 'unknown action' }, 404)

    let deckId = body.deckId
    if (action) {
      const state = actionState(deps.db, user.id, action)
      if (!state.unlocked) {
        return c.json(
          {
            error: 'action locked',
            missingUnlocks: state.missingUnlocks,
            equipMissing: state.equipMissing,
          },
          403,
        )
      }
      if (!state.affordable) {
        return c.json({ error: 'missing materials', missing: state.missing }, 409)
      }
      if (action.deckLevel) {
        const deck = listDecks(deps.db, user.id).find((d) => d.level === action.deckLevel)
        if (deck) deckId = deck.id
      }
    }

    const card = pickCard(deps.db, user.id, deckId)
    if (!card) return c.json({ error: 'no cards in this deck' }, 404)

    const learner = learnerOf(user)
    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
      judge: await judgeFor(c),
    }
    const def = body.exerciseId
      ? registry.get(body.exerciseId)
      : pickNextExercise(deps.db, user.id, card, learner)
    if (!def) return c.json({ error: 'no exercise available' }, 500)

    const instance = await def.generate(ctx)
    return c.json({
      instance,
      action: action
        ? {
            id: action.id,
            skillId: action.skillId,
            xp: action.xp,
            produces: action.produces ?? [],
            consumes: action.consumes ?? [],
          }
        : null,
    })
  })

  app.post('/api/practice/grade', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      exerciseId?: string
      cardId?: string
      answer?: unknown
      latencyMs?: number
      actionId?: string
    }
    const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
    if (!def) return c.json({ error: 'exercise not found' }, 404)

    // an action must be unlocked and affordable before it can settle
    if (body.actionId) {
      const action = ACTION_BY_ID.get(body.actionId)
      if (!action) return c.json({ error: 'unknown action' }, 404)
      const state = actionState(deps.db, user.id, action)
      if (!state.unlocked) {
        return c.json(
          {
            error: 'action locked',
            missingUnlocks: state.missingUnlocks,
            equipMissing: state.equipMissing,
          },
          403,
        )
      }
      if (!state.affordable)
        return c.json({ error: 'missing materials', missing: state.missing }, 409)
    }

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
    const { leveledUp } = awardXp(deps.db, deps.events, user.id, xp, 'review', def.id)
    recordActivity(deps.db, deps.events, user.id)
    deps.events.emit('review.completed', {
      userId: user.id,
      cardId: card.id,
      exerciseId: def.id,
      score: result.score,
      correct: result.correct,
    })
    const skill = settleAction(deps, user.id, body.actionId, result)

    return c.json({
      result: { ...result, xp, leveledUp },
      skill,
      stats: summary(deps.db, user.id),
    })
  })

  // Pronunciation: recorded audio -> ASR + forced alignment -> score + tips (§9.4).
  app.post('/api/practice/speak', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const form = await c.req.formData()
    const file = form.get('file')
    const cardId = String(form.get('cardId') ?? '')
    const exerciseId = String(form.get('exerciseId') ?? '')
    const actionId = form.get('actionId') ? String(form.get('actionId')) : undefined
    const latencyMs = Number(form.get('latencyMs') ?? 0)

    if (!(file instanceof File)) return c.json({ error: 'audio file required' }, 400)
    const card = cardId ? getCard(deps.db, cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = exerciseId ? registry.get(exerciseId) : undefined
    if (!def?.gradeAudio) return c.json({ error: 'exercise does not support audio grading' }, 400)

    if (actionId) {
      const action = ACTION_BY_ID.get(actionId)
      if (!action) return c.json({ error: 'unknown action' }, 404)
      const state = actionState(deps.db, user.id, action)
      if (!state.unlocked) {
        return c.json(
          {
            error: 'action locked',
            missingUnlocks: state.missingUnlocks,
            equipMissing: state.equipMissing,
          },
          403,
        )
      }
      if (!state.affordable)
        return c.json({ error: 'missing materials', missing: state.missing }, 409)
    }

    const audio = new Uint8Array(await file.arrayBuffer())
    const learner = learnerOf(user)
    const assess: AssessFn = deps.assess ?? makeAssessor(deps, card.targetLang)
    const ctx = { card, learner, distractors: [] as string[], judge: await judgeFor(c), assess }

    try {
      const instance = await def.generate(ctx)
      const result = await def.gradeAudio(ctx, instance, audio)
      const xp = def.xp(result, instance)
      addReview(deps.db, {
        cardId: card.id,
        userId: user.id,
        exerciseId: def.id,
        score: result.score,
        latencyMs,
        detail: result.detail,
      })
      const { leveledUp } = awardXp(deps.db, deps.events, user.id, xp, 'review', def.id)
      recordActivity(deps.db, deps.events, user.id)
      deps.events.emit('review.completed', {
        userId: user.id,
        cardId: card.id,
        exerciseId: def.id,
        score: result.score,
        correct: result.correct,
      })
      const skill = settleAction(deps, user.id, actionId, result)
      return c.json({
        result: { ...result, xp, leveledUp },
        skill,
        stats: summary(deps.db, user.id),
      })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })
}
