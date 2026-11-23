import type { UserId, CardId } from '../../ids'
import { and, eq, gte, ne, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { reviews } from '../schema'
import { id, now } from './helpers'

export interface ReviewInput {
  cardId: CardId
  userId: UserId
  exerciseId: string
  score: number
  latencyMs?: number
  detail?: Record<string, unknown>
  audioRef?: string
}

export function addReview(db: Db, r: ReviewInput): void {
  db.insert(reviews).values(reviewValues(r)).run()
}

function reviewValues(r: ReviewInput) {
  return {
    id: id(),
    cardId: r.cardId,
    userId: r.userId,
    exerciseId: r.exerciseId,
    score: r.score,
    latencyMs: r.latencyMs ?? 0,
    detailJson: JSON.stringify(r.detail ?? {}),
    audioRef: r.audioRef ?? null,
    createdAt: now(),
  }
}

export function lastExerciseUse(db: Db, userId: UserId): Map<string, number> {
  const rows = db
    .select({ exerciseId: reviews.exerciseId, last: sql<number>`max(${reviews.createdAt})` })
    .from(reviews)
    .where(eq(reviews.userId, userId))
    .groupBy(reviews.exerciseId)
    .all()
  return new Map(
    rows.filter((r) => r.exerciseId).map((r) => [r.exerciseId as string, Number(r.last)]),
  )
}

export function introducedCardIds(db: Db, userId: UserId): Set<CardId> {
  const rows = db
    .select({ cardId: reviews.cardId })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.exerciseId, 'introduce')))
    .all()
  return new Set(rows.map((r) => r.cardId).filter((c): c is CardId => Boolean(c)))
}

export interface DailyReviewCounts {
  newCards: number
  reviews: number
}

export function dailyReviewCounts(db: Db, userId: UserId, since: number): DailyReviewCounts {
  return { newCards: newToday(db, userId, since), reviews: gradedCount(db, userId, since) }
}

function newToday(db: Db, userId: UserId, since: number): number {
  return db
    .select({ cardId: reviews.cardId })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), ne(reviews.exerciseId, 'introduce')))
    .groupBy(reviews.cardId)
    .having(sql`min(${reviews.createdAt}) >= ${since}`)
    .all().length
}

function gradedCount(db: Db, userId: UserId, since: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, userId),
        ne(reviews.exerciseId, 'introduce'),
        gte(reviews.createdAt, since),
      ),
    )
    .get()
  return Number(row?.n ?? 0)
}

export function cardsGradedSince(db: Db, userId: UserId, since: number): number {
  const row = db
    .select({ n: sql<number>`count(distinct ${reviews.cardId})` })
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, userId),
        ne(reviews.exerciseId, 'introduce'),
        gte(reviews.createdAt, since),
      ),
    )
    .get()
  return Number(row?.n ?? 0)
}
