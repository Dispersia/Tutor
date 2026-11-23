/** `POST /api/practice/grade` — grade a submitted answer (docs/DESIGN.md §13.6). */

import type { Card, ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getCard, type PublicUser } from '../../db/repo'
import { INTRODUCE_ID, registry } from '../../exercises'
import { knownWords } from '../../services'
import { actionGate, type ActionRequest } from './action'
import { exerciseCtx } from './exerciseCtx'
import { judgeFor } from './judge'
import { finalizeReview, recordAttempt, uncountedOutcome } from './record'

interface GradeBody extends ActionRequest {
  exerciseId?: string
  cardId?: string
  answer?: unknown
  latencyMs?: number
  lessonId?: string
}

export function registerGrade(app: App) {
  app.post('/api/practice/grade', (c) => gradeHandler(c))
}

async function gradeHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = (await c.req.json().catch(() => ({}))) as GradeBody
  const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
  if (!card) return c.json({ error: 'card not found' }, 404)
  const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
  if (!def) return c.json({ error: 'exercise not found' }, 404)
  // An action must be unlocked and affordable before it can settle.
  const gate = actionGate(deps, user.id, body)
  if (gate.error) return c.json(gate.error.body, gate.error.status)
  return gradeAttempt({ c, deps, user, card, def, body })
}

/** One validated attempt: generate, grade, and settle what it earned. */
interface GradeCall {
  c: Context<AppEnv>
  deps: Deps
  user: PublicUser
  card: Card
  def: ExerciseDef
  body: GradeBody
}

async function gradeAttempt(call: GradeCall) {
  const { c, deps, user, card, def, body } = call
  const ctx = await gradeCtx(call)
  const instance = await def.generate(ctx)
  const result: GradeResult = await def.grade(ctx, instance, body.answer)
  const xp = def.id === INTRODUCE_ID ? 0 : def.xp(result, instance)
  recordAttempt(deps, {
    userId: user.id,
    card,
    exerciseId: def.id,
    result,
    latencyMs: body.latencyMs,
  })
  // A first-exposure "teach" step records that the card was introduced, but is
  // not a recall test: no XP, no schedule, no lesson completion.
  if (def.id === INTRODUCE_ID) return c.json(uncountedOutcome(deps, user.id, result))
  return c.json(settleGrade(call, result, xp))
}

async function gradeCtx(call: GradeCall): Promise<ExerciseContext> {
  const { c, deps, user, card } = call
  return {
    ...exerciseCtx(deps, user, card, { known: knownWords(deps.db, user.id), distractors: 3 }),
    judge: await judgeFor(c),
  }
}

function settleGrade(call: GradeCall, result: GradeResult, xp: number) {
  const { deps, user, card, def, body } = call
  return finalizeReview(deps, {
    userId: user.id,
    card,
    def,
    result,
    xp,
    latencyMs: body.latencyMs,
    actionId: body.actionId,
    choiceId: body.choiceId,
    lessonId: body.lessonId,
  })
}
