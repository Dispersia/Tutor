/** Spaced repetition: scheduling, the state map and the daily budget (docs/DESIGN.md §13.6). */

import type { UserId, CardId } from '../ids'
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
import { atomic } from '../db/repo/helpers'
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
import { startOfDay, userOffsetMin } from './clock'
import { readDailyExtra, readStudyPrefs } from './study'

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
export function desiredRetention(db: Db, userId: UserId): number {
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
function saveSchedule(db: Db, userId: UserId, cardId: CardId, state: FsrsState, now: number): void {
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

/** How many days since the card's previous review (0 for a new card). */
function elapsedDaysOf(prev: FsrsState, now: number): number {
  if (prev.state === 'new' || prev.lastReviewAt == null) return 0
  return Math.max(0, (now - prev.lastReviewAt) / DAY_MS)
}

/**
 * Advances a card's FSRS-6 schedule after a review, appends to the review log
 * and emits `srs.updated`. `source` records which surface fed the schedule.
 */
function recordReviewTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  req: { cardId: CardId; score: number; correct: boolean; source?: string },
): ReviewSchedule {
  const prev = prevStateOf(getSrs(db, userId, req.cardId))
  const now = Date.now()
  const rating = ratingFromScore(req.score, req.correct)
  const next = advance(db, userId, prev, rating, now)
  saveSchedule(db, userId, req.cardId, next.state, now)
  const source = req.source ?? 'practice'
  const retention = desiredRetention(db, userId)
  logReview({ db, userId, cardId: req.cardId, rating, prev, next, retention, now, source })
  emitSrs(bus, userId, req.cardId, rating, next.state)
  return scheduleResult(rating, next.state, next.intervalDays, next.dueAt)
}

/** {@link recordReviewTx}, all-or-nothing. */
export const recordReview = atomic(recordReviewTx)

/** The card's next schedule, at this member's retention and learning steps. */
function advance(db: Db, userId: UserId, prev: FsrsState, rating: Rating, now: number) {
  return schedule(prev, rating, now, {
    desiredRetention: desiredRetention(db, userId),
    learningSteps: readStudyPrefs(db, userId).learningSteps,
  })
}

interface ReviewLog {
  db: Db
  userId: UserId
  cardId: CardId
  rating: Rating
  prev: FsrsState
  next: { state: FsrsState; intervalDays: number; dueAt: number }
  retention: number
  now: number
  source: string
}

/** Appends the FSRS review log: enough history to replay the card later. */
function logReview(r: ReviewLog): void {
  addSrsReview(r.db, {
    userId: r.userId,
    cardId: r.cardId,
    rating: r.rating,
    stateBefore: r.prev.state,
    stateAfter: r.next.state.state,
    stabilityBefore: r.prev.stability,
    stabilityAfter: r.next.state.stability,
    difficultyBefore: r.prev.difficulty,
    difficultyAfter: r.next.state.difficulty,
    intervalDays: r.next.intervalDays,
    elapsedDays: elapsedDaysOf(r.prev, r.now),
    desiredRetention: r.retention,
    dueAt: r.next.dueAt,
    source: r.source,
  })
}

function emitSrs(
  bus: EventBus,
  userId: UserId,
  cardId: CardId,
  rating: Rating,
  state: FsrsState,
): void {
  bus.emit('srs.updated', {
    userId,
    cardId,
    reps: state.reps,
    dueAt: state.dueAt,
    intervalDays: state.intervalDays,
    rating,
    state: state.state,
  })
}

/** The wire-facing scheduling outcome of one review. */
function scheduleResult(
  rating: Rating,
  state: FsrsState,
  intervalDays: number,
  dueAt: number,
): ReviewSchedule {
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

export function srsStateMap(db: Db, userId: UserId): Map<CardId, FsrsState> {
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
  srs: Map<CardId, FsrsState>
}

/** The target-language words a learner currently knows (learned cards). */
export function knownWords(db: Db, userId: UserId, loaded?: LoadedCards): Set<string> {
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

/**
 * Today's study budget: how many new cards and reviews are left (docs/DESIGN.md
 * §13.6). Anki-style daily limits bound a day's work; the learner can raise
 * today's allowance with "study more".
 */
export function studyBudget(
  db: Db,
  userId: UserId,
  now: number = Date.now(),
  loaded?: LoadedCards,
): StudyBudget {
  const prefs = readStudyPrefs(db, userId)
  const extra = readDailyExtra(db, userId, now)
  // The budget is per day of the member's own calendar (see `clock.ts`).
  const counts = dailyReviewCounts(db, userId, startOfDay(now, userOffsetMin(db, userId, now)))
  const ids = (loaded?.cards ?? listCards(db, userId)).map((c) => c.id)
  const map = loaded?.srs ?? srsStateMap(db, userId)
  const limits = dailyLimits(prefs, extra)
  return {
    ...limits,
    newToday: counts.newCards,
    reviewsToday: counts.reviews,
    ...remaining({ ids, map, now, limits, counts }),
  }
}

interface BudgetCtx {
  ids: CardId[]
  map: Map<CardId, FsrsState>
  now: number
  limits: ReturnType<typeof dailyLimits>
  counts: { newCards: number; reviews: number }
}

/** How much of each budget is left; an unlimited budget counts what is available. */
function remaining(c: BudgetCtx) {
  const newUnlimited = c.limits.newPerDay === 0
  const reviewsUnlimited = c.limits.maxReviewsPerDay === 0
  return {
    newUnlimited,
    reviewsUnlimited,
    newRemaining: newUnlimited
      ? countNew(c.ids, c.map)
      : Math.max(0, c.limits.newPerDay - c.counts.newCards),
    reviewsRemaining: reviewsUnlimited
      ? countDue(c.ids, c.map, c.now)
      : Math.max(0, c.limits.maxReviewsPerDay - c.counts.reviews),
  }
}

/** Today's effective limits: the preference plus any "study more", 0 = unlimited. */
function dailyLimits(
  prefs: ReturnType<typeof readStudyPrefs>,
  extra: ReturnType<typeof readDailyExtra>,
) {
  return {
    newPerDay: prefs.newPerDay <= 0 ? 0 : prefs.newPerDay + extra.newExtra,
    maxReviewsPerDay: prefs.maxReviewsPerDay <= 0 ? 0 : prefs.maxReviewsPerDay + extra.reviewsExtra,
  }
}

export interface SrsStats {
  total: number
  learned: number
  due: number
  new: number
  budget: StudyBudget
}

export function srsStats(db: Db, userId: UserId): SrsStats {
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
