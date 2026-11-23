import type { UserId, CardId } from '../../ids'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { cards, srs, srsReviews } from '../schema'
import { id, now } from './helpers'

export function getSrs(db: Db, userId: UserId, cardId: CardId) {
  return db
    .select()
    .from(srs)
    .where(and(eq(srs.userId, userId), eq(srs.cardId, cardId)))
    .get()
}

export function listSrs(db: Db, userId: UserId) {
  return db.select().from(srs).where(eq(srs.userId, userId)).all()
}

export interface SrsWrite {
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
}

export function upsertSrs(db: Db, userId: UserId, cardId: CardId, s: SrsWrite): void {
  db.insert(srs)
    .values({ userId, cardId, ...s })
    .onConflictDoUpdate({ target: [srs.userId, srs.cardId], set: { ...s } })
    .run()
}

export interface SrsReviewWrite {
  userId: UserId
  cardId: CardId
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
}

export function addSrsReview(db: Db, r: SrsReviewWrite): void {
  db.insert(srsReviews)
    .values({ ...r, id: id(), createdAt: now() })
    .run()
}

export function listSrsReviews(db: Db, userId: UserId, cardId?: CardId) {
  const where = cardId
    ? and(eq(srsReviews.userId, userId), eq(srsReviews.cardId, cardId))
    : eq(srsReviews.userId, userId)
  return db.select().from(srsReviews).where(where).orderBy(asc(srsReviews.createdAt)).all()
}

export function countScheduledCards(db: Db, userId: UserId): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(srs)
    .innerJoin(cards, eq(cards.id, srs.cardId))
    .where(eq(srs.userId, userId))
    .get()
  return Number(row?.n ?? 0)
}
