import type { UserId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { ExerciseDef, GradeResult } from '@tutor/core'
import type { Deps } from '../../context'
import { addReview } from '../../db/repo'
import { maybeAutoGrow } from '../../deck/autoGrow'
import { REINFORCE_LAPSES, reinforceLapsedCard } from '../../deck/reinforce'
import { NEW_STATE } from '../../game/srs'
import { readStudyPrefs } from '../../services/study'
import {
  awardXp,
  checkLessonCompletion,
  recordReview,
  summary,
  touchActivity,
  type LoadedCards,
} from '../../services'
import { settleAction } from './action'

export interface ReviewOutcome {
  result: GradeResult & { xp: number; leveledUp: boolean }
  skill: ReturnType<typeof settleAction>
  srs: ReturnType<typeof recordReview> | null
  lessonCompleted: boolean
  stats: ReturnType<typeof summary>
}

export interface AttemptInput {
  userId: UserId
  card: ServerCard
  exerciseId: string
  result: GradeResult
  latencyMs?: number
}

export function addReviewRow(deps: Deps, input: AttemptInput): void {
  addReview(deps.db, {
    cardId: input.card.id,
    userId: input.userId,
    exerciseId: input.exerciseId,
    score: input.result.score,
    latencyMs: input.latencyMs,
    detail: input.result.detail,
  })
}

export function uncountedOutcome(deps: Deps, userId: UserId, result: GradeResult): ReviewOutcome {
  return {
    result: { ...result, xp: 0, leveledUp: false },
    skill: null,
    srs: null,
    lessonCompleted: false,
    stats: summary(deps.db, userId),
  }
}

export interface FinalizeInput {
  userId: UserId
  card: ServerCard
  def: ExerciseDef
  result: GradeResult
  xp: number
  data: LoadedCards
  latencyMs?: number
  actionId?: string
  choiceId?: string
  lessonId?: string
}

export function finalizeReview(deps: Deps, input: FinalizeInput): ReviewOutcome {
  const { userId, result } = input
  const leveledUp = awardReviewXp(deps, userId, input)
  touchActivity(deps.db, deps.events, userId)
  emitCompleted(deps, input)
  const skill = settleAction(deps, userId, input.actionId, result, input.choiceId)
  const srs = reviewSchedule(deps, userId, input)
  maybeReinforce(deps, input, srs.lapses)
  maybeAutoGrow(deps, userId, input.card)
  return {
    result: { ...result, xp: input.xp, leveledUp },
    skill,
    srs,
    lessonCompleted: lessonDone(deps, input, srs),
    stats: summary(deps.db, userId),
  }
}

function awardReviewXp(deps: Deps, userId: UserId, input: FinalizeInput): boolean {
  const { leveledUp } = awardXp(deps.db, deps.events, userId, {
    amount: input.xp,
    reason: 'review',
    sourceId: input.def.id,
  })
  return leveledUp
}

function reviewSchedule(deps: Deps, userId: UserId, input: FinalizeInput) {
  return recordReview(deps.db, deps.events, userId, {
    cardId: input.card.id,
    score: input.result.score,
    correct: input.result.correct,
  })
}

function emitCompleted(deps: Deps, input: FinalizeInput): void {
  deps.events.emit('review.completed', {
    userId: input.userId,
    cardId: input.card.id,
    exerciseId: input.def.id,
    score: input.result.score,
    correct: input.result.correct,
  })
}

function maybeReinforce(deps: Deps, input: FinalizeInput, lapses: number): void {
  if (input.card.payload?.template !== 'vocab') return
  if (lapses < REINFORCE_LAPSES) return
  if (!readStudyPrefs(deps.db, input.userId).autoReinforce) return
  void reinforceLapsedCard(deps, input.userId, input.card.id).catch(() => {})
}

function lessonDone(
  deps: Deps,
  input: FinalizeInput,
  reviewed: ReturnType<typeof recordReview>,
): boolean {
  if (!input.lessonId) return false
  const data = reviewedData(input, reviewed)
  return checkLessonCompletion(deps.db, deps.events, input.userId, input.lessonId, data)
}

function reviewedData(input: FinalizeInput, reviewed: ReturnType<typeof recordReview>) {
  const srs = new Map(input.data.srs)
  const prev = srs.get(input.card.id) ?? NEW_STATE
  srs.set(input.card.id, {
    ...prev,
    state: reviewed.state,
    intervalDays: reviewed.intervalDays,
    dueAt: reviewed.dueAt,
    stability: reviewed.stability,
    difficulty: reviewed.difficulty,
    step: reviewed.step,
    reps: reviewed.reps,
    lapses: reviewed.lapses,
    lastRating: reviewed.rating,
  })
  return { cards: input.data.cards, srs }
}
