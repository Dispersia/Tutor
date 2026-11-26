import { toCardId, type CardId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { Card, ExerciseContext, ExerciseDef, ExerciseInstance, GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getCard, type PublicUser } from '../../db/repo'
import { INTRODUCE_ID, registry, answerText } from '../../exercises'
import { knownWordsFor, loadLearnerData, type LoadedCards } from '../../services'
import { actionGate, type ActionRequest } from './action'
import { exerciseCtx, learnerOf } from './exerciseCtx'
import { readingMap } from './select'
import { wasIssued } from './issued'
import { judgeFor } from './judge'
import { recordGrade } from './record'
import { idField, jsonBody, num, str } from '../body'
import { fail, failWith, NOT_ISSUED_MESSAGE } from '../errors'

interface GradeBody extends ActionRequest {
  exerciseId?: string
  cardId?: CardId
  answer?: unknown
  latencyMs?: number
  lessonId?: string
}

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
  if (!card) return fail(c, 404, 'card not found')
  const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
  if (!def) return fail(c, 404, 'exercise not found')
  if (!fits(def, card, user)) return fail(c, 400, 'that exercise does not fit this card')
  if (!wasIssued(user.id, card.id, def.id)) return fail(c, 409, NOT_ISSUED_MESSAGE)
  const gate = actionGate(deps, user.id, body)
  if (gate.error) return failWith(c, gate.error)
  return gradeAttempt({ c, deps, user, card, def, body })
}

export function fits(def: ExerciseDef, card: Card, user: PublicUser): boolean {
  if (def.id === INTRODUCE_ID) return true
  return !def.temporarilyDisabled && def.supports(card, learnerOf(user, card.targetLang))
}

interface GradeCall {
  c: Context<AppEnv>
  deps: Deps
  user: PublicUser
  card: ServerCard
  def: ExerciseDef
  body: GradeBody
}

async function gradeAttempt(call: GradeCall) {
  const { c, deps, user, def, body } = call
  const data = loadLearnerData(deps.db, user.id)
  const ctx = await gradeCtx(call, data)
  const instance = await def.generate(ctx)
  const result: GradeResult = await def.grade(ctx, instance, body.answer)
  const answer = answerText(body.answer)
  if (answer) result.answer = answer
  return c.json(recordGrade(deps, gradeInput(call, data, result, instance)))
}

function gradeInput(
  call: GradeCall,
  data: LoadedCards,
  result: GradeResult,
  instance: ExerciseInstance,
) {
  const { user, card, def, body } = call
  return {
    userId: user.id,
    card,
    def,
    result,
    xp: def.id === INTRODUCE_ID ? 0 : def.xp(result, instance),
    data,
    latencyMs: body.latencyMs,
    actionId: body.actionId,
    choiceId: body.choiceId,
    lessonId: body.lessonId,
  }
}

async function gradeCtx(call: GradeCall, data: LoadedCards): Promise<ExerciseContext> {
  const { c, deps, user, card } = call
  return {
    ...exerciseCtx(deps, user, card, {
      known: knownWordsFor(deps.db, user.id, card.targetLang, data),
      readings: readingMap(deps.db, user.id, card.targetLang, data.cards),
      distractors: 3,
    }),
    judge: await judgeFor(c, card),
  }
}
