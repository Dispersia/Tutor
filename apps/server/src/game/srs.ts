/**
 * FSRS-6 spaced repetition (docs/DESIGN.md §13.6).
 *
 * A faithful reimplementation of the Free Spaced Repetition Scheduler v6 — the
 * algorithm Anki 25.07+ uses — with Anki's default parameters (21 weights), the
 * power-law forgetting curve with trainable decay (w20), Anki's default learning
 * steps (1m, 10m) and relearning steps (10m), and intervals derived from a
 * desired retention.
 *
 * Reference: open-spaced-repetition/fsrs-rs (model_v6) + the FSRS-6 algorithm
 * write-up. Pure functions, unit-tested.
 */

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

/** Anki's FSRS-6 default parameters (also FSRS-6.1.1). */
export const FSRS6_WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const

export const S_MIN = 0.001
export const S_MAX = 36500
export const D_MIN = 1
export const D_MAX = 10
/** w20: the personalisable forgetting-curve decay. */
export const DECAY = FSRS6_WEIGHTS[20]
export const MAX_INTERVAL_DAYS = 36500

export const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_MS = 60 * 1000

/** Anki's default learning/relearning steps, in minutes. */
export const LEARNING_STEPS = [1, 10]
export const RELEARNING_STEPS = [10]

const w = (i: number) => FSRS6_WEIGHTS[i]!
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** `factor = 0.9^(-1/decay) − 1`, so R(t = S) = 0.9. */
export function forgettingFactor(decay: number = DECAY): number {
  if (Math.abs(decay) < Number.EPSILON) return 0
  return Math.pow(0.9, -1 / decay) - 1
}

/** Retrievability after `elapsedDays` given stability `s`. */
export function retrievability(s: number, elapsedDays: number, decay: number = DECAY): number {
  if (s <= 0) return 0
  if (elapsedDays <= 0) return 1
  const factor = forgettingFactor(decay)
  return clamp(Math.pow(1 + (factor * elapsedDays) / s, -decay), 0, 1)
}

export function initialStability(rating: Rating): number {
  return clamp(w(rating - 1), S_MIN, S_MAX)
}

export function initialDifficulty(rating: Rating): number {
  const d = w(4) - Math.exp(w(5) * (rating - 1)) + 1
  return clamp(d, D_MIN, D_MAX)
}

/** ΔD = −w6·(G−3), damped by (10−D)/9, then mean-reverted toward D0(Easy). */
export function nextDifficulty(d: number, rating: Rating): number {
  const delta = -w(6) * (rating - 3)
  const damped = d + (delta * (10 - d)) / 9
  const reverted = w(7) * initialDifficulty(EASY) + (1 - w(7)) * damped
  return clamp(reverted, D_MIN, D_MAX)
}

/** Stability after a successful recall (Hard/Good/Easy). */
export function stabilityAfterRecall(s: number, d: number, r: number, rating: Rating): number {
  const hardPenalty = rating === HARD ? w(15) : 1
  const easyBonus = rating === EASY ? w(16) : 1
  const factor =
    Math.exp(w(8)) *
      (11 - d) *
      Math.pow(s, -w(9)) *
      (Math.exp(w(10) * (1 - r)) - 1) *
      hardPenalty *
      easyBonus +
    1
  return clamp(s * factor, S_MIN, S_MAX)
}

/** Stability after a lapse (Again): never larger than the old stability. */
export function stabilityAfterForget(s: number, d: number, r: number): number {
  const next =
    w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r))
  return clamp(Math.min(next, s), S_MIN, S_MAX)
}

/** FSRS-6 short-term (same-day) stability update. */
export function sameDayStability(s: number, rating: Rating): number {
  const next = s * Math.exp(w(17) * (rating - 3 + w(18))) * Math.pow(s, -w(19))
  return clamp(next, S_MIN, S_MAX)
}

/** Interval (days) that brings stability `s` down to `desiredRetention`. */
export function nextInterval(s: number, desiredRetention: number, decay: number = DECAY): number {
  if (s <= 0 || desiredRetention >= 1 || desiredRetention <= 0) return 0
  const factor = forgettingFactor(decay)
  const interval = (s / factor) * (Math.pow(desiredRetention, -1 / decay) - 1)
  return Math.max(0, Math.round(interval))
}

/** Maps an exercise score to an Anki rating (Again / Hard / Good / Easy). */
export function ratingFromScore(score: number, correct: boolean): Rating {
  if (!correct) return AGAIN
  if (score >= 90) return EASY
  if (score >= 80) return GOOD
  return HARD
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

/** Advances a card one review, the way Anki's FSRS scheduler does. */
export function schedule(
  prev: FsrsState,
  rating: Rating,
  now: number,
  opts: ScheduleOptions = {},
): ScheduleResult {
  const desiredRetention = opts.desiredRetention ?? 0.9
  const maxInterval = opts.maxIntervalDays ?? MAX_INTERVAL_DAYS
  const learningSteps = opts.learningSteps ?? LEARNING_STEPS
  const relearningSteps = opts.relearningSteps ?? RELEARNING_STEPS

  const elapsedDays =
    prev.state === 'new' || prev.lastReviewAt == null
      ? 0
      : Math.max(0, (now - prev.lastReviewAt) / DAY_MS)

  const reviewInterval = (stability: number): number =>
    clamp(nextInterval(stability, desiredRetention), 1, maxInterval)

  const stepDelay = (steps: number[], step: number): number => {
    const minutes = steps[Math.min(step, steps.length - 1)] ?? 10
    return now + minutes * MIN_MS
  }

  // --- a brand new card ------------------------------------------------------
  if (prev.state === 'new') {
    const stability = initialStability(rating)
    const difficulty = initialDifficulty(rating)
    const base: FsrsState = {
      state: 'learning',
      step: 0,
      stability,
      difficulty,
      reps: prev.reps + 1,
      lapses: rating === AGAIN ? 1 : 0,
      intervalDays: 0,
      dueAt: 0,
      lastReviewAt: now,
      lastRating: rating,
    }
    if (rating === EASY || learningSteps.length === 0) {
      // Easy graduates straight away
      const intervalDays = reviewInterval(stability)
      return {
        state: {
          ...base,
          state: 'review',
          step: 0,
          intervalDays,
          dueAt: now + intervalDays * DAY_MS,
        },
        intervalDays,
        dueAt: now + intervalDays * DAY_MS,
        rating,
      }
    }
    // Again/Hard stay on the first step; Good moves to the second step
    const step = rating === GOOD && learningSteps.length > 1 ? 1 : 0
    const dueAt = stepDelay(learningSteps, step)
    return {
      state: { ...base, step, dueAt, intervalDays: 0 },
      intervalDays: 0,
      dueAt,
      rating,
    }
  }

  const r = retrievability(prev.stability, elapsedDays)
  const inSteps = prev.state === 'learning' || prev.state === 'relearning'
  const steps = prev.state === 'relearning' ? relearningSteps : learningSteps

  // --- same-day review: FSRS short-term memory ------------------------------
  if (elapsedDays < 1) {
    const stability = sameDayStability(prev.stability, rating)
    const difficulty = nextDifficulty(prev.difficulty, rating)
    const base: FsrsState = {
      ...prev,
      stability,
      difficulty,
      reps: prev.reps + 1,
      lapses: rating === AGAIN ? prev.lapses + 1 : prev.lapses,
      lastReviewAt: now,
      lastRating: rating,
    }
    if (inSteps) {
      const step = rating === GOOD || rating === EASY ? prev.step + 1 : prev.step
      if (step >= steps.length || rating === EASY) {
        const intervalDays = reviewInterval(stability)
        return {
          state: {
            ...base,
            state: 'review',
            step: 0,
            intervalDays,
            dueAt: now + intervalDays * DAY_MS,
          },
          intervalDays,
          dueAt: now + intervalDays * DAY_MS,
          rating,
        }
      }
      const dueAt = stepDelay(steps, step)
      return { state: { ...base, step, dueAt, intervalDays: 0 }, intervalDays: 0, dueAt, rating }
    }
    // a review card answered again the same day just keeps its interval
    return {
      state: { ...base, intervalDays: prev.intervalDays },
      intervalDays: prev.intervalDays,
      dueAt: prev.dueAt,
      rating,
    }
  }

  // --- a lapse ---------------------------------------------------------------
  if (rating === AGAIN) {
    const stability = stabilityAfterForget(prev.stability, prev.difficulty, r)
    const difficulty = nextDifficulty(prev.difficulty, rating)
    const dueAt = stepDelay(relearningSteps, 0)
    return {
      state: {
        ...prev,
        state: 'relearning',
        step: 0,
        stability,
        difficulty,
        reps: prev.reps + 1,
        lapses: prev.lapses + 1,
        intervalDays: 0,
        dueAt,
        lastReviewAt: now,
        lastRating: rating,
      },
      intervalDays: 0,
      dueAt,
      rating,
    }
  }

  // --- a successful review ---------------------------------------------------
  const stability = stabilityAfterRecall(prev.stability, prev.difficulty, r, rating)
  const difficulty = nextDifficulty(prev.difficulty, rating)
  const base: FsrsState = {
    ...prev,
    stability,
    difficulty,
    reps: prev.reps + 1,
    lastReviewAt: now,
    lastRating: rating,
  }

  if (inSteps) {
    const step = rating === HARD ? prev.step : prev.step + 1
    if (step >= steps.length) {
      const intervalDays = reviewInterval(stability)
      return {
        state: {
          ...base,
          state: 'review',
          step: 0,
          intervalDays,
          dueAt: now + intervalDays * DAY_MS,
        },
        intervalDays,
        dueAt: now + intervalDays * DAY_MS,
        rating,
      }
    }
    const dueAt = stepDelay(steps, step)
    return { state: { ...base, step, dueAt, intervalDays: 0 }, intervalDays: 0, dueAt, rating }
  }

  const intervalDays = reviewInterval(stability)
  return {
    state: { ...base, state: 'review', step: 0, intervalDays, dueAt: now + intervalDays * DAY_MS },
    intervalDays,
    dueAt: now + intervalDays * DAY_MS,
    rating,
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
 * Picks the card to study next: overdue first, then new, then the soonest due.
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

export function countDue(cardIds: string[], srs: Map<string, FsrsState>, now: number): number {
  return cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  }).length
}

export function countNew(cardIds: string[], srs: Map<string, FsrsState>): number {
  return cardIds.filter((id) => !srs.has(id)).length
}
