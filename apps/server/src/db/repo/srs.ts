/** Spaced-repetition state and its review log (FSRS). */

import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { srs, srsReviews } from '../schema'
import { id, now } from './helpers'

export function getSrs(db: Db, userId: string, cardId: string) {
  return db
    .select()
    .from(srs)
    .where(and(eq(srs.userId, userId), eq(srs.cardId, cardId)))
    .get()
}

export function listSrs(db: Db, userId: string) {
  return db.select().from(srs).where(eq(srs.userId, userId)).all()
}

export function upsertSrs(
  db: Db,
  userId: string,
  cardId: string,
  s: {
    state: string
    step: number
    stability: number
    difficulty: number
    reps: number
    lapses: number
    intervalDays: number
    dueAt: number
    lastRating: number | null
    lastReviewAt: number
  },
): void {
  db.insert(srs)
    .values({ userId, cardId, ...s })
    .onConflictDoUpdate({ target: [srs.userId, srs.cardId], set: { ...s } })
    .run()
}

/** Appends one FSRS review to the log (docs/DESIGN.md §13.6). */
export function addSrsReview(
  db: Db,
  r: {
    userId: string
    cardId: string
    rating: number
    stateBefore: string
    stateAfter: string
    stabilityBefore: number
    stabilityAfter: number
    difficultyBefore: number
    difficultyAfter: number
    intervalDays: number
    elapsedDays: number
    desiredRetention: number
    dueAt: number
    source?: string
  },
): void {
  db.insert(srsReviews)
    .values({ ...r, id: id(), createdAt: now() })
    .run()
}

/** The review log for one user, or one card, oldest first. */
export function listSrsReviews(db: Db, userId: string, cardId?: string) {
  const where = cardId
    ? and(eq(srsReviews.userId, userId), eq(srsReviews.cardId, cardId))
    : eq(srsReviews.userId, userId)
  return db.select().from(srsReviews).where(where).orderBy(asc(srsReviews.createdAt)).all()
}
