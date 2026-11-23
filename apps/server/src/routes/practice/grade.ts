/** `POST /api/practice/grade` — grade a submitted answer (docs/DESIGN.md §13.6). */

import { toCardId, type CardId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { Card, ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getCard, type PublicUser } from '../../db/repo'
import { INTRODUCE_ID, registry } from '../../exercises'
import { knownWords } from '../../services'
import { actionGate, type ActionRequest } from './action'
import { exerciseCtx, learnerOf } from './exerciseCtx'
import { wasIssued } from './issued'
import { judgeFor } from './judge'
import { finalizeReview, recordAttempt, uncountedOutcome } from './record'
import { idField, jsonBody, num, str } from '../body'

interface GradeBody extends ActionRequest {
  exerciseId?: string
  cardId?: CardId
  answer?: unknown
  latencyMs?: number
  lessonId?: string
}

/** Reads a grade request: the exercise, the card and the learner's answer. */
function readGradeBody(body: Record<string, unknown>): GradeBody {
  return {
    actionId: str(body, 'actionId'),
    choiceId: str(body, 'choiceId'),
    exerciseId: str(body, 'exerciseId'),
    cardId: idField(body, 'cardId', toCardId),
    answer: body.answer,
    latencyMs: num(body, 'latencyMs'),
    lessonId: str(body, 'lessonId'),
  }
}

export function registerGrade(app: App) {
  app.post('/api/practice/grade', (c) => gradeHandler(c))
}

async function gradeHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = readGradeBody(await jsonBody(c))
  const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
  if (!card) return c.json({ error: 'card not found' }, 404)
  const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
  if (!def) return c.json({ error: 'exercise not found' }, 404)
  if (!fits(def, card, user)) return c.json({ error: 'that exercise does not fit this card' }, 400)
  if (!wasIssued(user.id, card.id, def.id)) return c.json({ error: NOT_ISSUED }, 409)
  // An action must be unlocked and affordable before it can settle.
  const gate = actionGate(deps, user.id, body)
  if (gate.error) return c.json(gate.error.body, gate.error.status)
  return gradeAttempt({ c, deps, user, card, def, body })
}

/**
 * A grade is only taken for a drill the server could have served: the exercise
 * must support the card and not be switched off product-wide. The drill itself
 * must also be one that was handed to this member (`issued.ts`).
 */
const NOT_ISSUED = 'that drill was not the one you were given — load the next card'

function fits(def: ExerciseDef, card: Card, user: PublicUser): boolean {
  if (def.id === INTRODUCE_ID) return true
  return !def.temporarilyDisabled && def.supports(card, learnerOf(user))
}

/** One validated attempt: generate, grade, and settle what it earned. */
interface GradeCall {
  c: Context<AppEnv>
  deps: Deps
  user: PublicUser
  card: ServerCard
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
