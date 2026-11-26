import { FSRS6_DEFAULT_WEIGHTS, FSRS6Model } from 'ts-fsrs/models/fsrs-6'

export type Rating = 1 | 2 | 3 | 4
export const AGAIN: Rating = 1
export const HARD: Rating = 2
export const GOOD: Rating = 3
export const EASY: Rating = 4

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export interface FsrsState {
  state: CardState
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

export const FSRS6_WEIGHTS: readonly number[] = FSRS6_DEFAULT_WEIGHTS

export const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_MS = 60 * 1000

export const LEARNING_STEPS = [1, 10]
export const RELEARNING_STEPS = [10]

const core = FSRS6Model.create({
  config: {
    weights: [...FSRS6_WEIGHTS],
    enableShortTerm: true,
    numRelearningSteps: RELEARNING_STEPS.length,
  },
})

const S_MIN = core.bounds.sMin
const S_MAX = core.bounds.sMax
const D_MIN = core.bounds.dMin
const D_MAX = core.bounds.dMax
const MAX_INTERVAL_DAYS = 36500

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function retrievability(s: number, elapsedDays: number): number {
  if (s <= 0) return 0
  if (elapsedDays <= 0) return 1
  return clamp(core.algorithm.forgetting_curve(elapsedDays, s), 0, 1)
}

function initialStability(rating: Rating): number {
  return clamp(core.algorithm.init_stability(rating), S_MIN, S_MAX)
}

function initialDifficulty(rating: Rating): number {
  return clamp(core.algorithm.init_difficulty(rating), D_MIN, D_MAX)
}

function nextDifficulty(d: number, rating: Rating): number {
  return clamp(core.algorithm.next_difficulty(d, rating), D_MIN, D_MAX)
}

function stabilityAfterRecall(s: number, d: number, r: number, rating: Rating): number {
  return clamp(core.algorithm.next_recall_stability(d, s, r, rating), S_MIN, S_MAX)
}

function stabilityAfterForget(s: number, d: number, r: number): number {
  return clamp(core.algorithm.next_forget_stability(d, s, r), S_MIN, S_MAX)
}

export function sameDayStability(s: number, rating: Rating): number {
  return clamp(core.algorithm.next_short_term_stability(s, rating), S_MIN, S_MAX)
}

export function nextInterval(s: number, desiredRetention: number): number {
  if (s <= 0 || desiredRetention >= 1 || desiredRetention <= 0) return 0
  return Math.max(0, Math.round(core.algorithm.next_interval(s, desiredRetention)))
}

export function ratingFromScore(score: number, correct: boolean): Rating {
  if (!correct) return AGAIN
  if (score >= 65) return GOOD
  return HARD
}

export interface ScheduleOptions {
  desiredRetention?: number
  maxIntervalDays?: number
  learningSteps?: number[]
  relearningSteps?: number[]
}

export interface ScheduleResult {
  state: FsrsState
  intervalDays: number
  dueAt: number
  rating: Rating
}

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

function reviewInterval(stability: number, ctx: SchedCtx): number {
  return clamp(nextInterval(stability, ctx.desiredRetention), 1, ctx.maxInterval)
}

function stepDelay(steps: number[], step: number, now: number): number {
  const minutes = steps[Math.min(step, steps.length - 1)] ?? 10
  return now + minutes * MIN_MS
}

export function schedule(
  prev: FsrsState,
  rating: Rating,
  now: number,
  opts: ScheduleOptions = {},
): ScheduleResult {
  const ctx = schedCtx(now, rating, opts)
  if (prev.state === 'new') return newCard(prev, ctx)
  const elapsed = prev.lastReviewAt == null ? 0 : Math.max(0, (now - prev.lastReviewAt) / DAY_MS)
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
  const step = ctx.rating === GOOD && ctx.learningSteps.length > 1 ? 1 : 0
  return stayStep(base, ctx.learningSteps, step, ctx)
}

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
  if (!inSteps(prev)) return sameDayReview(base, prev, ctx)
  const steps = stepsFor(prev, ctx)
  const step = ctx.rating === GOOD || ctx.rating === EASY ? prev.step + 1 : prev.step
  if (step >= steps.length || ctx.rating === EASY) return graduate(base, stability, ctx)
  return stayStep(base, steps, step, ctx)
}

function sameDayReview(base: FsrsState, prev: FsrsState, ctx: SchedCtx): ScheduleResult {
  if (prev.dueAt > ctx.now) return keepInterval(base, prev, ctx)
  if (ctx.rating !== AGAIN) return graduate(base, base.stability, ctx)
  return stayStep({ ...base, state: 'relearning' }, ctx.relearningSteps, 0, ctx)
}

function keepInterval(base: FsrsState, prev: FsrsState, ctx: SchedCtx): ScheduleResult {
  return {
    state: { ...base, intervalDays: prev.intervalDays },
    intervalDays: prev.intervalDays,
    dueAt: prev.dueAt,
    rating: ctx.rating,
  }
}

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

function stayStep(base: FsrsState, steps: number[], step: number, ctx: SchedCtx): ScheduleResult {
  const dueAt = stepDelay(steps, step, ctx.now)
  return {
    state: { ...base, step, dueAt, intervalDays: 0 },
    intervalDays: 0,
    dueAt,
    rating: ctx.rating,
  }
}

function isDue(state: FsrsState, now: number): boolean {
  return state.dueAt <= now
}

export function isLearned(state: FsrsState | undefined): boolean {
  return Boolean(state && state.state === 'review' && state.intervalDays >= 1)
}

export function selectCardId<T extends string>(
  cardIds: T[],
  srs: Map<string, FsrsState>,
  now: number,
): T | undefined {
  if (cardIds.length === 0) return undefined
  const due = cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  })
  if (due.length) return due.sort((a, b) => (srs.get(a)!.dueAt ?? 0) - (srs.get(b)!.dueAt ?? 0))[0]
  const fresh = cardIds.filter((id) => !srs.has(id))
  if (fresh.length) return fresh[0]
  return cardIds
    .slice()
    .sort((a, b) => lastSeen(srs, a) - lastSeen(srs, b) || dueOf(srs, a) - dueOf(srs, b))[0]
}

const lastSeen = (srs: Map<string, FsrsState>, id: string): number => srs.get(id)?.lastReviewAt ?? 0
const dueOf = (srs: Map<string, FsrsState>, id: string): number => srs.get(id)?.dueAt ?? 0

export function selectStudyCardId<T extends string>(
  cardIds: T[],
  srs: Map<string, FsrsState>,
  now: number,
): T | undefined {
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
