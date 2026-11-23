/**
 * FSRS-6 spaced repetition (docs/DESIGN.md §13.6).
 *
 * The memory math comes from `ts-fsrs` (the reference TypeScript implementation,
 * FSRS-6 model, Anki's default 21 weights, power-law curve with trainable decay
 * w20). This module owns the scheduling state machine around it: Anki's default
 * learning steps (1m, 10m) and relearning steps (10m), due dates, card selection
 * and the curriculum's notion of a "learned" card.
 */
import { FSRS6_DEFAULT_WEIGHTS, FSRS6Model } from 'ts-fsrs/models/fsrs-6'

export type Rating = 1 | 2 | 3 | 4 // Again, Hard, Good, Easy
export const AGAIN: Rating = 1
export const HARD: Rating = 2
export const GOOD: Rating = 3
export const EASY: Rating = 4

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export interface FsrsState {
  state: CardState
  /** index into the learning/relearning step list */
  step: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  intervalDays: number
  dueAt: number
  lastReviewAt: number | null
  lastRating: Rating | null
}

export const NEW_STATE: FsrsState = {
  state: 'new',
  step: 0,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  intervalDays: 0,
  dueAt: 0,
  lastReviewAt: null,
  lastRating: null,
}

/** Anki's FSRS-6 default parameters (also FSRS-6.1.1), from ts-fsrs. */
export const FSRS6_WEIGHTS: readonly number[] = FSRS6_DEFAULT_WEIGHTS

export const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_MS = 60 * 1000

/** Anki's default learning/relearning steps, in minutes. */
export const LEARNING_STEPS = [1, 10]
export const RELEARNING_STEPS = [10]

/** The FSRS-6 core: memory-state updates, forgetting curve and intervals. */
const core = FSRS6Model.create({
  config: {
    weights: [...FSRS6_WEIGHTS],
    enableShortTerm: true,
    numRelearningSteps: RELEARNING_STEPS.length,
  },
})

export const S_MIN = core.bounds.sMin
export const S_MAX = core.bounds.sMax
export const D_MIN = core.bounds.dMin
export const D_MAX = core.bounds.dMax
export const MAX_INTERVAL_DAYS = 36500

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Retrievability after `elapsedDays` given stability `s`. */
export function retrievability(s: number, elapsedDays: number): number {
  if (s <= 0) return 0
  if (elapsedDays <= 0) return 1
  return clamp(core.algorithm.forgetting_curve(elapsedDays, s), 0, 1)
}

/** ts-fsrs returns raw initial values; the model bounds them like fsrs-rs does. */
export function initialStability(rating: Rating): number {
  return clamp(core.algorithm.init_stability(rating), S_MIN, S_MAX)
}

export function initialDifficulty(rating: Rating): number {
  return clamp(core.algorithm.init_difficulty(rating), D_MIN, D_MAX)
}

/** ΔD = −w6·(G−3), damped by (10−D)/9, then mean-reverted toward D0(Easy). */
export function nextDifficulty(d: number, rating: Rating): number {
  return clamp(core.algorithm.next_difficulty(d, rating), D_MIN, D_MAX)
}

/** Stability after a successful recall (Hard/Good/Easy). */
export function stabilityAfterRecall(s: number, d: number, r: number, rating: Rating): number {
  return clamp(core.algorithm.next_recall_stability(d, s, r, rating), S_MIN, S_MAX)
}

/** Stability after a lapse (Again), capped so it never exceeds the prior stability. */
export function stabilityAfterForget(s: number, d: number, r: number): number {
  return clamp(core.algorithm.next_forget_stability(d, s, r), S_MIN, S_MAX)
}

/** FSRS-6 short-term (same-day) stability update, never shrinking on pass. */
export function sameDayStability(s: number, rating: Rating): number {
  return clamp(core.algorithm.next_short_term_stability(s, rating), S_MIN, S_MAX)
}

/** Interval (days) that brings stability `s` down to `desiredRetention`. */
export function nextInterval(s: number, desiredRetention: number): number {
  if (s <= 0 || desiredRetention >= 1 || desiredRetention <= 0) return 0
  return Math.max(0, Math.round(core.algorithm.next_interval(s, desiredRetention)))
}

/**
 * Maps an exercise score to an FSRS rating. We only ever use **Again** (wrong)
 * or **Good** (right): the app auto-derives the rating, and FSRS is best trained
 * and scheduled with the two-way signal. Hard/Easy are intentionally unused —
 * letting a near-perfect score jump a card straight to "Easy" is what made new
 * cards graduate (and vanish for days) after a single answer.
 */
export function ratingFromScore(_score: number, correct: boolean): Rating {
  return correct ? GOOD : AGAIN
}

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
}

export interface ScheduleOptions {
  desiredRetention?: number
  maxIntervalDays?: number
  learningSteps?: number[]
  relearningSteps?: number[]
}

export interface ScheduleResult {
  state: FsrsState
  /** days until the next review (0 when it is a same-day step) */
  intervalDays: number
  dueAt: number
  rating: Rating
}

/** The knobs and clock one `schedule` call works with. */
interface SchedCtx {
  now: number
  rating: Rating
  desiredRetention: number
  maxInterval: number
  learningSteps: number[]
  relearningSteps: number[]
}

const inSteps = (prev: FsrsState): boolean =>
  prev.state === 'learning' || prev.state === 'relearning'

const stepsFor = (prev: FsrsState, ctx: SchedCtx): number[] =>
  prev.state === 'relearning' ? ctx.relearningSteps : ctx.learningSteps

/** The interval that brings stability down to the desired retention, clamped. */
function reviewInterval(stability: number, ctx: SchedCtx): number {
  return clamp(nextInterval(stability, ctx.desiredRetention), 1, ctx.maxInterval)
}

/** When the next step of a learning/relearning ladder falls due. */
function stepDelay(steps: number[], step: number, now: number): number {
  const minutes = steps[Math.min(step, steps.length - 1)] ?? 10
  return now + minutes * MIN_MS
}

/** Advances a card one review, the way Anki's FSRS scheduler does. */
export function schedule(
  prev: FsrsState,
  rating: Rating,
  now: number,
  opts: ScheduleOptions = {},
): ScheduleResult {
  const ctx = schedCtx(now, rating, opts)
  if (prev.state === 'new') return newCard(prev, ctx)
  const elapsed = prev.lastReviewAt == null ? 0 : Math.max(0, (now - prev.lastReviewAt) / DAY_MS)
  // A same-day review is FSRS short-term memory, not a new interval.
  if (elapsed < 1) return sameDay(prev, ctx)
  const r = retrievability(prev.stability, elapsed)
  return rating === AGAIN ? lapse(prev, r, ctx) : reviewPass(prev, r, ctx)
}

function schedCtx(now: number, rating: Rating, opts: ScheduleOptions): SchedCtx {
  return {
    now,
    rating,
    desiredRetention: opts.desiredRetention ?? 0.9,
    maxInterval: opts.maxIntervalDays ?? MAX_INTERVAL_DAYS,
    learningSteps: opts.learningSteps ?? LEARNING_STEPS,
    relearningSteps: opts.relearningSteps ?? RELEARNING_STEPS,
  }
}

/** A brand-new card: Easy graduates at once, otherwise it enters the ladder. */
function newCard(prev: FsrsState, ctx: SchedCtx): ScheduleResult {
  const stability = initialStability(ctx.rating)
  const base: FsrsState = {
    state: 'learning',
    step: 0,
    stability,
    difficulty: initialDifficulty(ctx.rating),
    reps: prev.reps + 1,
    lapses: ctx.rating === AGAIN ? 1 : 0,
    intervalDays: 0,
    dueAt: 0,
    lastReviewAt: ctx.now,
    lastRating: ctx.rating,
  }
  if (ctx.rating === EASY || ctx.learningSteps.length === 0) return graduate(base, stability, ctx)
  // Again/Hard stay on the first step; Good moves to the second step.
  const step = ctx.rating === GOOD && ctx.learningSteps.length > 1 ? 1 : 0
  return stayStep(base, ctx.learningSteps, step, ctx)
}

/** A same-day review: short-term stability, and the ladder moves in steps. */
function sameDay(prev: FsrsState, ctx: SchedCtx): ScheduleResult {
  const stability = sameDayStability(prev.stability, ctx.rating)
  const base: FsrsState = {
    ...prev,
    stability,
    difficulty: nextDifficulty(prev.difficulty, ctx.rating),
    reps: prev.reps + 1,
    lapses: ctx.rating === AGAIN ? prev.lapses + 1 : prev.lapses,
    lastReviewAt: ctx.now,
    lastRating: ctx.rating,
  }
  if (!inSteps(prev)) return keepInterval(base, prev, ctx)
  const steps = stepsFor(prev, ctx)
  const step = ctx.rating === GOOD || ctx.rating === EASY ? prev.step + 1 : prev.step
  if (step >= steps.length || ctx.rating === EASY) return graduate(base, stability, ctx)
  return stayStep(base, steps, step, ctx)
}

/** A review card answered again the same day just keeps its interval. */
function keepInterval(base: FsrsState, prev: FsrsState, ctx: SchedCtx): ScheduleResult {
  return {
    state: { ...base, intervalDays: prev.intervalDays },
    intervalDays: prev.intervalDays,
    dueAt: prev.dueAt,
    rating: ctx.rating,
  }
}

/** A lapse: back to relearning, with a shrunken stability. */
function lapse(prev: FsrsState, r: number, ctx: SchedCtx): ScheduleResult {
  const stability = stabilityAfterForget(prev.stability, prev.difficulty, r)
  const dueAt = stepDelay(ctx.relearningSteps, 0, ctx.now)
  const state: FsrsState = {
    ...prev,
    state: 'relearning',
    step: 0,
    stability,
    difficulty: nextDifficulty(prev.difficulty, ctx.rating),
    reps: prev.reps + 1,
    lapses: prev.lapses + 1,
    intervalDays: 0,
    dueAt,
    lastReviewAt: ctx.now,
    lastRating: ctx.rating,
  }
  return { state, intervalDays: 0, dueAt, rating: ctx.rating }
}

/** A successful review after a real interval: graduate, or advance the ladder. */
function reviewPass(prev: FsrsState, r: number, ctx: SchedCtx): ScheduleResult {
  const stability = stabilityAfterRecall(prev.stability, prev.difficulty, r, ctx.rating)
  const base: FsrsState = {
    ...prev,
    stability,
    difficulty: nextDifficulty(prev.difficulty, ctx.rating),
    reps: prev.reps + 1,
    lastReviewAt: ctx.now,
    lastRating: ctx.rating,
  }
  if (!inSteps(prev)) return graduate(base, stability, ctx)
  const steps = stepsFor(prev, ctx)
  const step = ctx.rating === HARD ? prev.step : prev.step + 1
  return step >= steps.length ? graduate(base, stability, ctx) : stayStep(base, steps, step, ctx)
}

/** Leaves the ladder: the card is in review with a real day+ interval. */
function graduate(base: FsrsState, stability: number, ctx: SchedCtx): ScheduleResult {
  const intervalDays = reviewInterval(stability, ctx)
  const dueAt = ctx.now + intervalDays * DAY_MS
  return {
    state: { ...base, state: 'review', step: 0, intervalDays, dueAt },
    intervalDays,
    dueAt,
    rating: ctx.rating,
  }
}

/** Waits on the next learning/relearning step, still due today. */
function stayStep(base: FsrsState, steps: number[], step: number, ctx: SchedCtx): ScheduleResult {
  const dueAt = stepDelay(steps, step, ctx.now)
  return {
    state: { ...base, step, dueAt, intervalDays: 0 },
    intervalDays: 0,
    dueAt,
    rating: ctx.rating,
  }
}

export function isDue(state: FsrsState, now: number): boolean {
  return state.dueAt <= now
}

/** Anki-ish: a card counts as learned once it has graduated to a day+ interval. */
export function isLearned(state: FsrsState | undefined): boolean {
  return Boolean(state && state.state === 'review' && state.intervalDays >= 1)
}

/**
 * Picks the card to study next: overdue first, then new, then the soonest due —
 * including a card that is not due yet. Callers that must always have something
 * to show (combat wants a card for every hit) use this; practice uses
 * `selectStudyCardId`, which never reaches past a review card's due date.
 * `cardIds` is in syllabus order; `srs` maps card id -> state.
 */
export function selectCardId(
  cardIds: string[],
  srs: Map<string, FsrsState>,
  now: number,
): string | undefined {
  if (cardIds.length === 0) return undefined
  const due = cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  })
  if (due.length) return due.sort((a, b) => (srs.get(a)!.dueAt ?? 0) - (srs.get(b)!.dueAt ?? 0))[0]
  const fresh = cardIds.filter((id) => !srs.has(id))
  if (fresh.length) return fresh[0]
  return cardIds.slice().sort((a, b) => (srs.get(a)?.dueAt ?? 0) - (srs.get(b)?.dueAt ?? 0))[0]
}

/**
 * Picks the card to study next: overdue first, then new, and nothing else.
 *
 * A **review card is never served ahead of its due date**. A same-day review of
 * a review card leaves the due date untouched (see `schedule`), so reaching past
 * a not-yet-due review card hands back the very same card again and again. A
 * learning/relearning step that is not due yet waits too (the lesson queue moves
 * on to the next new word instead of re-showing it). When nothing is due and no
 * new word is left, the day is done. Combat, which must always have a card for a
 * hit, keeps using `selectCardId`.
 */
export function selectStudyCardId(
  cardIds: string[],
  srs: Map<string, FsrsState>,
  now: number,
): string | undefined {
  if (cardIds.length === 0) return undefined
  const due = cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  })
  if (due.length) return due.sort((a, b) => (srs.get(a)!.dueAt ?? 0) - (srs.get(b)!.dueAt ?? 0))[0]
  return cardIds.find((id) => !srs.has(id))
}

export function countDue(cardIds: string[], srs: Map<string, FsrsState>, now: number): number {
  return cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  }).length
}

export function countNew(cardIds: string[], srs: Map<string, FsrsState>): number {
  return cardIds.filter((id) => !srs.has(id)).length
}
