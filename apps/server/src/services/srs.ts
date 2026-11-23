/** Spaced repetition: scheduling, the state map and the daily budget (docs/DESIGN.md §13.6). */

import {
  addSrsReview,
  dailyReviewCounts,
  getSrs,
  getUserSetting,
  listCards,
  listSrs,
  upsertSrs,
} from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import {
  DAY_MS,
  NEW_STATE,
  countDue,
  countNew,
  isLearned,
  ratingFromScore,
  schedule,
  type FsrsState,
  type Rating,
} from '../game/srs'
import { readDailyExtra, readStudyPrefs } from '../game/study'

// --- spaced repetition + curriculum (Phase 9, docs/DESIGN.md §13.6) ----------

/** The scheduling outcome returned to the API/UI after a review. */
export interface ReviewSchedule {
  rating: Rating
  state: FsrsState['state']
  intervalDays: number
  dueAt: number
  stability: number
  difficulty: number
  step: number
  reps: number
  lapses: number
}

/** A user's desired retention as a fraction (Anki-style percent, default 90%). */
export function desiredRetention(db: Db, userId: string): number {
  const raw = Number(getUserSetting(db, userId, 'desiredRetention') ?? 90)
  const pct = Number.isFinite(raw) ? Math.min(97, Math.max(70, Math.round(raw))) : 90
  return pct / 100
}

/** The card's current FSRS state, or a fresh one for a card never reviewed. */
function prevStateOf(row: ReturnType<typeof getSrs>): FsrsState {
  if (!row) return NEW_STATE
  return {
    state: row.state as FsrsState['state'],
    step: row.step,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    intervalDays: row.intervalDays,
    dueAt: row.dueAt,
    lastReviewAt: row.lastReviewAt,
    lastRating: (row.lastRating as Rating | null) ?? null,
  }
}

/** Writes the advanced schedule back, stamping `lastReviewAt` when it is new. */
function saveSchedule(db: Db, userId: string, cardId: string, state: FsrsState, now: number): void {
  upsertSrs(db, userId, cardId, {
    state: state.state,
    step: state.step,
    stability: state.stability,
    difficulty: state.difficulty,
    reps: state.reps,
    lapses: state.lapses,
    intervalDays: state.intervalDays,
    dueAt: state.dueAt,
    lastRating: state.lastRating,
    lastReviewAt: state.lastReviewAt ?? now,
  })
}

/**
 * Advances a card's FSRS-6 schedule after a review, appends to the review log
 * and emits `srs.updated`. `source` records which surface fed the schedule.
 */
export function recordReview(
  db: Db,
  bus: EventBus,
  userId: string,
  cardId: string,
  score: number,
  correct: boolean,
  opts: { source?: string } = {},
): ReviewSchedule {
  const prev = prevStateOf(getSrs(db, userId, cardId))
  const now = Date.now()
  const rating = ratingFromScore(score, correct)
  const retention = desiredRetention(db, userId)
  const elapsedDays =
    prev.state === 'new' || prev.lastReviewAt == null
      ? 0
      : Math.max(0, (now - prev.lastReviewAt) / DAY_MS)
  const { state, intervalDays, dueAt } = schedule(prev, rating, now, {
    desiredRetention: retention,
    learningSteps: readStudyPrefs(db, userId).learningSteps,
  })
  saveSchedule(db, userId, cardId, state, now)
  addSrsReview(db, {
    userId,
    cardId,
    rating,
    stateBefore: prev.state,
    stateAfter: state.state,
    stabilityBefore: prev.stability,
    stabilityAfter: state.stability,
    difficultyBefore: prev.difficulty,
    difficultyAfter: state.difficulty,
    intervalDays,
    elapsedDays,
    desiredRetention: retention,
    dueAt,
    source: opts.source ?? 'practice',
  })
  bus.emit('srs.updated', {
    userId,
    cardId,
    reps: state.reps,
    dueAt: state.dueAt,
    intervalDays: state.intervalDays,
    rating,
    state: state.state,
  })
  return {
    rating,
    state: state.state,
    intervalDays,
    dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    step: state.step,
    reps: state.reps,
    lapses: state.lapses,
  }
}

export function srsStateMap(db: Db, userId: string): Map<string, FsrsState> {
  return new Map(
    listSrs(db, userId).map((r) => [
      r.cardId,
      {
        state: r.state as FsrsState['state'],
        step: r.step,
        stability: r.stability,
        difficulty: r.difficulty,
        reps: r.reps,
        lapses: r.lapses,
        intervalDays: r.intervalDays,
        dueAt: r.dueAt,
        lastReviewAt: r.lastReviewAt,
        lastRating: (r.lastRating as Rating | null) ?? null,
      } satisfies FsrsState,
    ]),
  )
}

/** The expensive per-user maps, when a caller has already loaded them. */
export interface LoadedCards {
  cards: ReturnType<typeof listCards>
  srs: Map<string, FsrsState>
}

/** The target-language words a learner currently knows (learned cards). */
export function knownWords(db: Db, userId: string, loaded?: LoadedCards): Set<string> {
  const srsMap = loaded?.srs ?? srsStateMap(db, userId)
  const known = new Set<string>()
  for (const c of loaded?.cards ?? listCards(db, userId)) {
    if (isLearned(srsMap.get(c.id))) known.add(c.back)
  }
  return known
}

export interface StudyBudget {
  /** Effective limits; 0 means unlimited. */
  newPerDay: number
  maxReviewsPerDay: number
  /** How much of each budget is already spent today (UTC). */
  newToday: number
  reviewsToday: number
  /** What is left under the budget (the available count when unlimited). */
  newRemaining: number
  reviewsRemaining: number
  newUnlimited: boolean
  reviewsUnlimited: boolean
}

/** Start of the UTC day containing `ts`, in epoch ms (matches the streak day). */
export function startOfUtcDay(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Today's study budget: how many new cards and reviews are left (docs/DESIGN.md
 * §13.6). Anki-style daily limits bound a day's work; the learner can raise
 * today's allowance with "study more".
 */
export function studyBudget(
  db: Db,
  userId: string,
  now: number = Date.now(),
  loaded?: LoadedCards,
): StudyBudget {
  const prefs = readStudyPrefs(db, userId)
  const extra = readDailyExtra(db, userId, now)
  const { newCards, reviews } = dailyReviewCounts(db, userId, startOfUtcDay(now))
  const ids = (loaded?.cards ?? listCards(db, userId)).map((c) => c.id)
  const map = loaded?.srs ?? srsStateMap(db, userId)
  const newPerDay = prefs.newPerDay <= 0 ? 0 : prefs.newPerDay + extra.newExtra
  const maxReviewsPerDay =
    prefs.maxReviewsPerDay <= 0 ? 0 : prefs.maxReviewsPerDay + extra.reviewsExtra
  const newUnlimited = newPerDay === 0
  const reviewsUnlimited = maxReviewsPerDay === 0
  return {
    newPerDay,
    maxReviewsPerDay,
    newToday: newCards,
    reviewsToday: reviews,
    newRemaining: newUnlimited ? countNew(ids, map) : Math.max(0, newPerDay - newCards),
    reviewsRemaining: reviewsUnlimited
      ? countDue(ids, map, now)
      : Math.max(0, maxReviewsPerDay - reviews),
    newUnlimited,
    reviewsUnlimited,
  }
}

export interface SrsStats {
  total: number
  learned: number
  due: number
  new: number
  budget: StudyBudget
}

export function srsStats(db: Db, userId: string): SrsStats {
  const now = Date.now()
  const cards = listCards(db, userId)
  const map = srsStateMap(db, userId)
  const ids = cards.map((c) => c.id)
  return {
    total: ids.length,
    learned: ids.filter((id) => isLearned(map.get(id))).length,
    due: countDue(ids, map, now),
    new: countNew(ids, map),
    budget: studyBudget(db, userId, now, { cards, srs: map }),
  }
}
