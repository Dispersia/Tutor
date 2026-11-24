import { toDeckId, toCardId, type UserId, type DeckId, type CardId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { Card, ExerciseContext, ExerciseDef, ExerciseInstance } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getCard, getDeck, introducedCardIds, listDecks, type PublicUser } from '../../db/repo'
import { INTRODUCE_ID, registry } from '../../exercises'
import { bumpDailyExtra, readStudyPrefs, type StudyPrefs } from '../../services/study'
import { type ActionDef } from '../../game/skills'
import { selectStudyCardId } from '../../game/srs'
import { quietState } from '../../services/quiet'
import {
  knownWords,
  loadLearnerData,
  studyBudget,
  type LoadedCards,
  type StudyBudget,
} from '../../services'
import { actionGate, type ActionRequest, type GuardError } from './action'
import { exerciseCtx, type SessionUser } from './exerciseCtx'
import { noteIssued } from './issued'
import { judgeFor } from './judge'
import {
  lessonOfCard,
  noDrillMessage,
  pickNextExercise,
  pickStudyCard,
  resolveLesson,
} from './select'
import { idField, jsonBody, str } from '../body'

interface NextBody extends ActionRequest {
  deckId?: DeckId
  exerciseId?: string
  lessonId?: string
  cardId?: CardId
}

interface Served {
  data: LoadedCards
  budget: StudyBudget
  card?: ServerCard
  lessonId?: string
  error?: GuardError
}

function readNextBody(body: Record<string, unknown>): NextBody {
  return {
    actionId: str(body, 'actionId'),
    choiceId: str(body, 'choiceId'),
    deckId: idField(body, 'deckId', toDeckId),
    exerciseId: str(body, 'exerciseId'),
    lessonId: str(body, 'lessonId'),
    cardId: idField(body, 'cardId', toCardId),
  }
}

export function registerNext(app: App) {
  app.post('/api/practice/next', (c) => nextHandler(c))
}

async function nextHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = readNextBody(await jsonBody(c))
  const prefs = readStudyPrefs(deps.db, user.id)
  const gate = actionGate(deps, user.id, body)
  if (gate.error) return c.json(gate.error.body, gate.error.status)
  const deck = resolveDeck(deps, user, body, gate.action, prefs)
  if (deck.error) return c.json(deck.error.body, deck.error.status)
  return resolveAndServe(c, { deps, user, body, prefs, deckId: deck.deckId, action: gate.action })
}

interface NextCall {
  deps: Deps
  user: PublicUser
  body: NextBody
  prefs: StudyPrefs
  deckId?: DeckId
  action?: ActionDef
}

async function resolveAndServe(c: Context<AppEnv>, call: NextCall) {
  const served = resolveTarget(call.deps, call.user, call.body, call.deckId)
  if (served.error) return c.json(served.error.body, served.error.status)
  if (!served.card) {
    return c.json({ instance: null, action: null, done: true, budget: served.budget })
  }
  return serveCard(c, {
    deps: call.deps,
    user: call.user,
    body: call.body,
    prefs: call.prefs,
    data: served.data,
    card: served.card,
    lessonId: served.lessonId,
    action: call.action,
  })
}

function resolveDeck(
  deps: Deps,
  user: PublicUser,
  body: NextBody,
  action: ActionDef | undefined,
  prefs: StudyPrefs,
): { deckId?: DeckId; error?: GuardError } {
  if (body.lessonId) return lessonDeck(deps, user.id, body.lessonId)
  const fromAction = deckForAction(deps, user.id, action)
  if (fromAction) return { deckId: fromAction }
  if (body.deckId) return { deckId: body.deckId }
  if (prefs.activeDeckId && getDeck(deps.db, prefs.activeDeckId)) {
    return { deckId: prefs.activeDeckId }
  }
  return {}
}

function lessonDeck(
  deps: Deps,
  userId: UserId,
  lessonId: string,
): { deckId?: DeckId; error?: GuardError } {
  const lesson = resolveLesson(deps, userId, lessonId)
  return lesson
    ? { deckId: lesson.deckId }
    : { error: { status: 404, body: { error: 'unknown lesson' } } }
}

function deckForAction(deps: Deps, userId: UserId, action?: ActionDef): DeckId | undefined {
  if (!action?.deckLevel) return undefined
  return listDecks(deps.db).find((d) => d.level === action.deckLevel)?.id
}

function resolveTarget(
  deps: Deps,
  user: PublicUser,
  body: NextBody,
  deckId: DeckId | undefined,
): Served {
  const data = loadLearnerData(deps.db, user.id)
  const deckIds = deckCardIds(data, deckId)
  const budget = budgetForDeck(deps, user.id, deckIds, data, {
    targeted: Boolean(body.cardId),
    now: Date.now(),
  })
  const card = pickCard({ deps, user, body, data, budget, deckIds })
  if (typeof card === 'string') return { data, budget, error: notFound(card) }
  if (!card) return { data, budget }
  const lessonId = body.lessonId ? lessonOfCard(deps, user.id, card) : undefined
  return { data, budget, card, lessonId }
}

interface PickReq {
  deps: Deps
  user: PublicUser
  body: NextBody
  data: LoadedCards
  budget: StudyBudget
  deckIds: CardId[]
}

function pickCard(req: PickReq): ServerCard | undefined | 'card not found' {
  const { deps, user, body, data, budget, deckIds } = req
  const allowed = allowedCardIds(deckIds, data, budget)
  if (body.cardId && !getCard(deps.db, body.cardId, user.id)) return 'card not found'
  const ids = body.cardId ? allowed.filter((id) => id === body.cardId) : allowed
  if (ids.length === 0) return undefined
  return body.cardId
    ? getCard(deps.db, body.cardId, user.id)
    : pickStudyCard(deps, user.id, ids, data.srs)
}

function notFound(message: string): GuardError {
  return { status: 404, body: { error: message } }
}

function deckCardIds(data: LoadedCards, deckId: DeckId | undefined): CardId[] {
  const cards = deckId ? data.cards.filter((c) => c.deckId === deckId) : data.cards
  return cards.map((c) => c.id)
}

function budgetForDeck(
  deps: Deps,
  userId: UserId,
  deckIds: CardId[],
  data: LoadedCards,
  opts: { targeted: boolean; now: number },
): StudyBudget {
  const budget = studyBudget(deps.db, userId, opts.now, data)
  if (opts.targeted) return budget
  const next = selectStudyCardId(deckIds, data.srs, opts.now)
  if (next === undefined) return budget
  const blocked = data.srs.has(next)
    ? !(budget.reviewsUnlimited || budget.reviewsRemaining > 0)
    : !(budget.newUnlimited || budget.newRemaining > 0)
  if (!blocked) return budget
  bumpDailyExtra(deps.db, userId, data.srs.has(next) ? { reviewsExtra: 1 } : { newExtra: 1 })
  return studyBudget(deps.db, userId, opts.now, data)
}

function allowedCardIds(deckIds: CardId[], data: LoadedCards, budget: StudyBudget): CardId[] {
  const allowNew = budget.newUnlimited || budget.newRemaining > 0
  const allowReview = budget.reviewsUnlimited || budget.reviewsRemaining > 0
  return deckIds.filter((id) => (data.srs.has(id) ? allowReview : allowNew))
}

interface ServeCardReq {
  deps: Deps
  user: PublicUser
  body: NextBody
  prefs: StudyPrefs
  data: LoadedCards
  card: ServerCard
  lessonId?: string
  action?: ActionDef
}

async function serveCard(c: Context<AppEnv>, req: ServeCardReq) {
  const ctx = await buildCtx(c, {
    deps: req.deps,
    user: req.user,
    card: req.card,
    data: req.data,
    prefs: req.prefs,
  })
  const instance = await serveDrill(drillRequest(req, ctx))
  if (typeof instance === 'string') return c.json({ error: instance }, 409)
  noteIssued(req.user.id, instance)
  if (instance.exerciseId === 'type_listen') enqueueListen(req.deps, req.user, req.card)
  return c.json({ instance, action: actionSummary(req.action), lessonId: req.lessonId })
}

function drillRequest(req: ServeCardReq, ctx: ExerciseContext): DrillRequest {
  return {
    deps: req.deps,
    user: req.user,
    card: req.card,
    data: req.data,
    ctx,
    exerciseId: req.body.exerciseId,
    quiet: quietState(req.deps.db, req.user.id).active,
    disabled: new Set(req.prefs.disabledExercises),
  }
}

async function buildCtx(
  c: Context<AppEnv>,
  req: { deps: Deps; user: PublicUser; card: ServerCard; data: LoadedCards; prefs: StudyPrefs },
): Promise<ExerciseContext> {
  return {
    ...exerciseCtx(req.deps, req.user, req.card, {
      known: knownWords(req.deps.db, req.user.id, req.data),
      prefs: req.prefs,
      cardPool: req.data.cards,
      seen: metWords(req.deps, req.user, req.data, req.card),
      distractors: 3,
    }),
    judge: await judgeFor(c, req.card),
  }
}

function metWords(deps: Deps, user: SessionUser, data: LoadedCards, card: Card): string[] {
  const introduced = introducedCardIds(deps.db, user.id)
  const met = new Set(knownWords(deps.db, user.id, data))
  for (const c of data.cards) if (introduced.has(c.id) || data.srs.has(c.id)) met.add(c.back)
  met.delete(card.back)
  return [...met]
}

function enqueueListen(deps: Deps, user: SessionUser, card: Card): void {
  deps.audio?.enqueue([{ userId: user.id, text: card.back, language: card.targetLang }])
}

function actionSummary(action?: ActionDef) {
  if (!action) return null
  return {
    id: action.id,
    skillId: action.skillId,
    xp: action.xp,
    produces: action.produces ?? [],
    consumes: action.consumes ?? [],
  }
}

interface DrillRequest {
  deps: Deps
  user: PublicUser
  card: ServerCard
  data: LoadedCards
  ctx: ExerciseContext
  exerciseId?: string
  quiet: boolean
  disabled: ReadonlySet<string>
}

async function serveDrill(req: DrillRequest): Promise<ExerciseInstance | string> {
  const { deps, user, card, ctx } = req
  const pick = { ctx, quiet: req.quiet, disabled: req.disabled }
  if (needsIntro(req)) {
    const intro = registry.get(INTRODUCE_ID)
    if (intro) return intro.generate(ctx)
  }
  const def = req.exerciseId
    ? registry.get(req.exerciseId)
    : pickNextExercise(deps.db, user.id, card, ctx.learner, pick)
  if (!def) return noDrillMessage(req.disabled)
  const chosen = isBlocked(def, req)
    ? pickNextExercise(deps.db, user.id, card, ctx.learner, pick)
    : def
  if (!chosen) return noDrillMessage(req.disabled)
  return chosen.generate(ctx)
}

function needsIntro(req: DrillRequest): boolean {
  if (req.exerciseId) return false
  const teachable = !req.card.payload?.template || req.card.payload.template === 'vocab'
  if (!teachable || req.data.srs.has(req.card.id)) return false
  return !introducedCardIds(req.deps.db, req.user.id).has(req.card.id)
}

function isBlocked(def: ExerciseDef<unknown>, req: DrillRequest): boolean {
  return (
    def.temporarilyDisabled || (req.quiet && def.modality === 'voice') || req.disabled.has(def.id)
  )
}
