/**
 * Recording a graded drill (docs/DESIGN.md §13.6).
 *
 * The practice grade path and the audio path share this: an attempt row, XP,
 * the activity stamp of the day's streak, the profession action, the FSRS
 * schedule and the reinforcement hook. Only how the grade was produced differs.
 */

import type { Card, ExerciseDef, GradeResult } from '@tutor/core'
import type { Deps } from '../../context'
import { addReview } from '../../db/repo'
import { REINFORCE_LAPSES, reinforceLapsedCard } from '../../deck/reinforce'
import { readStudyPrefs } from '../../services/study'
import {
  awardXp,
  checkLessonCompletion,
  recordReview,
  summary,
  touchActivity,
} from '../../services'
import { settleAction } from './action'

/** The counters a route needs to lay out its reply (shared by grade and speak). */
export interface ReviewOutcome {
  result: GradeResult & { xp: number; leveledUp: boolean }
  skill: ReturnType<typeof settleAction>
  srs: ReturnType<typeof recordReview> | null
  lessonCompleted: boolean
  stats: ReturnType<typeof summary>
}

/** Appends the review log row. Called for every countable attempt, XP or not. */
export interface AttemptInput {
  userId: string
  card: Card
  exerciseId: string
  result: GradeResult
  latencyMs?: number
}

export function recordAttempt(deps: Deps, input: AttemptInput): void {
  addReview(deps.db, {
    cardId: input.card.id,
    userId: input.userId,
    exerciseId: input.exerciseId,
    score: input.result.score,
    latencyMs: input.latencyMs,
    detail: input.result.detail,
  })
}

/** The reply for an attempt that must not count: no XP, no schedule, no lesson. */
export function uncountedOutcome(deps: Deps, userId: string, result: GradeResult): ReviewOutcome {
  return {
    result: { ...result, xp: 0, leveledUp: false },
    skill: null,
    srs: null,
    lessonCompleted: false,
    stats: summary(deps.db, userId),
  }
}

export interface FinalizeInput {
  userId: string
  card: Card
  def: ExerciseDef
  result: GradeResult
  xp: number
  latencyMs?: number
  actionId?: string
  choiceId?: string
  lessonId?: string
}

/**
 * Advances everything a counted review touches and returns the reply payload:
 * XP, the day's activity, the profession action + idle rig, the SRS schedule,
 * the reinforcement hook and lesson completion.
 */
export function finalizeReview(deps: Deps, input: FinalizeInput): ReviewOutcome {
  const { userId, result } = input
  const leveledUp = awardReviewXp(deps, userId, input)
  touchActivity(deps.db, deps.events, userId)
  emitCompleted(deps, input)
  const skill = settleAction(deps, userId, input.actionId, result, input.choiceId)
  const srs = reviewSchedule(deps, userId, input)
  maybeReinforce(deps, input, srs.lapses)
  return {
    result: { ...result, xp: input.xp, leveledUp },
    skill,
    srs,
    lessonCompleted: lessonDone(deps, input),
    stats: summary(deps.db, userId),
  }
}

/** Pays the review's XP (the reason is fixed: a graded card review). */
function awardReviewXp(deps: Deps, userId: string, input: FinalizeInput): boolean {
  const { leveledUp } = awardXp(deps.db, deps.events, userId, {
    amount: input.xp,
    reason: 'review',
    sourceId: input.def.id,
  })
  return leveledUp
}

/** Advances the card's FSRS schedule for this review. */
function reviewSchedule(deps: Deps, userId: string, input: FinalizeInput) {
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

/**
 * A word that keeps slipping gets an extra card woven in beside it (n+1), in the
 * background so the learner never waits on the generator.
 */
function maybeReinforce(deps: Deps, input: FinalizeInput, lapses: number): void {
  if (input.card.payload?.template !== 'vocab') return
  if (lapses < REINFORCE_LAPSES) return
  if (!readStudyPrefs(deps.db, input.userId).autoReinforce) return
  void reinforceLapsedCard(deps, input.userId, input.card.id).catch(() => {})
}

function lessonDone(deps: Deps, input: FinalizeInput): boolean {
  return input.lessonId
    ? checkLessonCompletion(deps.db, deps.events, input.userId, input.lessonId)
    : false
}
