import { toCardId, type CardId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getCard, type PublicUser } from '../../db/repo'
import { registry } from '../../exercises'
import { knownWords } from '../../services'
import { makeAssessor, type AssessFn } from '../../pronunciation/assess'
import { actionGate } from './action'
import { exerciseCtx } from './exerciseCtx'
import { wasIssued } from './issued'
import { judgeFor } from './judge'
import { addReviewRow, finalizeReview, uncountedOutcome } from './record'
import { fail, failWith, NOT_ISSUED_MESSAGE } from '../errors'

interface SpokenFields {
  cardId: CardId
  exerciseId: string
  actionId?: string
  lessonId?: string
  choiceId?: string
  latencyMs: number
  retry: boolean
}

export function registerSpeak(app: App) {
  app.post('/api/practice/speak', (c) => speakHandler(c))
}

async function speakHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return fail(c, 400, 'audio file required')
  const fields = spokenFields(form)
  const card = fields.cardId ? getCard(deps.db, fields.cardId, user.id) : undefined
  if (!card) return fail(c, 404, 'card not found')
  const def = fields.exerciseId ? registry.get(fields.exerciseId) : undefined
  if (!def?.gradeAudio) return fail(c, 400, 'exercise does not support audio grading')
  if (!wasIssued(user.id, card.id, def.id)) return fail(c, 409, NOT_ISSUED_MESSAGE)
  const gate = actionGate(deps, user.id, { actionId: fields.actionId, choiceId: fields.choiceId })
  if (gate.error) return failWith(c, gate.error)
  return gradeSpoken({ c, deps, user, card, def, fields, file })
}

function spokenFields(form: FormData): SpokenFields {
  const str = (name: string) => (form.get(name) ? String(form.get(name)) : undefined)
  return {
    cardId: toCardId(String(form.get('cardId') ?? '')),
    exerciseId: String(form.get('exerciseId') ?? ''),
    actionId: str('actionId'),
    lessonId: str('lessonId'),
    choiceId: str('choiceId'),
    latencyMs: Number(form.get('latencyMs') ?? 0),
    retry: String(form.get('retry') ?? '') === 'true',
  }
}

interface SpeakCall {
  c: Context<AppEnv>
  deps: Deps
  user: PublicUser
  card: ServerCard
  def: ExerciseDef
  fields: SpokenFields
  file: File
}

async function gradeSpoken(call: SpeakCall) {
  const { c, deps, user, fields } = call
  const audio = new Uint8Array(await call.file.arrayBuffer())
  const ctx = await speakCtx(call)
  try {
    const instance = await call.def.generate(ctx)
    const result = await call.def.gradeAudio!(ctx, instance, audio)
    const transcript = result.detail?.transcript
    if (typeof transcript === 'string' && transcript.trim()) result.answer = transcript.trim()
    if (result.detail?.noSpeech || fields.retry) {
      return c.json(uncountedOutcome(deps, user.id, result))
    }
    return c.json(settleSpoken(call, result, call.def.xp(result, instance)))
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

async function speakCtx(call: SpeakCall): Promise<ExerciseContext> {
  const { c, deps, user, card } = call
  const assess: AssessFn = deps.assess ?? makeAssessor(deps, card.targetLang)
  return {
    ...exerciseCtx(deps, user, card, { known: knownWords(deps.db, user.id) }),
    assess,
    judge: await judgeFor(c, card),
  }
}

function settleSpoken(call: SpeakCall, result: GradeResult, xp: number) {
  const { deps, user, card, def, fields } = call
  addReviewRow(deps, {
    userId: user.id,
    card,
    exerciseId: def.id,
    result,
    latencyMs: fields.latencyMs,
  })
  return finalizeReview(deps, finalizeArgs(call, result, xp))
}

function finalizeArgs(call: SpeakCall, result: GradeResult, xp: number) {
  const { user, card, def, fields } = call
  return {
    userId: user.id,
    card,
    def,
    result,
    xp,
    latencyMs: fields.latencyMs,
    actionId: fields.actionId,
    choiceId: fields.choiceId,
    lessonId: fields.lessonId,
  }
}
