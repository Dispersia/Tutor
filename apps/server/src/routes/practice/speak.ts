/**
 * `POST /api/practice/speak` — recorded audio -> ASR + forced alignment -> score
 * and tips (docs/DESIGN.md §9.4). Graded like any attempt, but a silent clip or
 * a retry is left out of the schedule.
 */

import type { Card, ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getCard, type PublicUser } from '../../db/repo'
import { registry } from '../../exercises'
import { knownWords } from '../../services'
import { makeAssessor, type AssessFn } from '../../pronunciation/assess'
import { actionGate } from './action'
import { exerciseCtx } from './exerciseCtx'
import { judgeFor } from './judge'
import { finalizeReview, recordAttempt, uncountedOutcome } from './record'

/** The multipart fields of a spoken attempt, read off the form. */
interface SpokenFields {
  cardId: string
  exerciseId: string
  actionId?: string
  lessonId?: string
  choiceId?: string
  latencyMs: number
  /** A retry (re-record after a miss) is graded but never counted. */
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
  if (!(file instanceof File)) return c.json({ error: 'audio file required' }, 400)
  const fields = spokenFields(form)
  const card = fields.cardId ? getCard(deps.db, fields.cardId, user.id) : undefined
  if (!card) return c.json({ error: 'card not found' }, 404)
  const def = fields.exerciseId ? registry.get(fields.exerciseId) : undefined
  if (!def?.gradeAudio) return c.json({ error: 'exercise does not support audio grading' }, 400)
  const gate = actionGate(deps, user.id, { actionId: fields.actionId, choiceId: fields.choiceId })
  if (gate.error) return c.json(gate.error.body, gate.error.status)
  return gradeSpoken({ c, deps, user, card, def, fields, file })
}

function spokenFields(form: FormData): SpokenFields {
  const str = (name: string) => (form.get(name) ? String(form.get(name)) : undefined)
  return {
    cardId: String(form.get('cardId') ?? ''),
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
  card: Card
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
    // A silent/too-short clip must not count as a wrong answer, and a retry also
    // stays out of the schedule: just ask for another attempt.
    if (result.detail?.noSpeech || fields.retry) {
      return c.json(uncountedOutcome(deps, user.id, result))
    }
    return c.json(settleSpoken(call, result, call.def.xp(result, instance)))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

async function speakCtx(call: SpeakCall): Promise<ExerciseContext> {
  const { c, deps, user, card } = call
  // No ASR biasing here: the deck vocabulary is deliberately kept out of the
  // decode. Whisper would fold it into its initial prompt and read a course word
  // back out (saying いる, hearing います), so grading stays honest and the forced
  // aligner anchors to the expected text instead.
  const assess: AssessFn = deps.assess ?? makeAssessor(deps, card.targetLang)
  return {
    ...exerciseCtx(deps, user, card, { known: knownWords(deps.db, user.id) }),
    assess,
    judge: await judgeFor(c),
  }
}

function settleSpoken(call: SpeakCall, result: GradeResult, xp: number) {
  const { deps, user, card, def, fields } = call
  recordAttempt(deps, {
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
