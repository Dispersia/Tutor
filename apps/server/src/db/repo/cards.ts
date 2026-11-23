/** Cards: creation, edits and the read queries practice and review share. */

import type { Card, CardMetadata, CardType } from '@tutor/core'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { cards, reviews, srs } from '../schema'
import { id, now } from './helpers'

export interface NewCard {
  deckId: string
  type?: CardType
  sourceLang: string
  targetLang: string
  front: string
  back: string
  readings?: Record<string, string>
  tags?: string[]
  payload?: Record<string, unknown>
  /** Language-agnostic annotations (pitch accent, radicals, …). */
  metadata?: CardMetadata
  origin?: 'curated' | 'llm' | 'manual'
}

export function addCard(db: Db, userId: string, c: NewCard) {
  const row = {
    id: id(),
    deckId: c.deckId,
    userId,
    type: c.type ?? 'vocab',
    sourceLang: c.sourceLang,
    targetLang: c.targetLang,
    front: c.front,
    back: c.back,
    readingsJson: JSON.stringify(c.readings ?? {}),
    tagsJson: JSON.stringify(c.tags ?? []),
    payloadJson: JSON.stringify(c.payload ?? {}),
    metadataJson: JSON.stringify(c.metadata ?? {}),
    origin: c.origin ?? 'manual',
    createdAt: now(),
  }
  db.insert(cards).values(row).run()
  return row
}

/**
 * Updates a card's content in place. Keeps the same id, so review history and
 * SRS scheduling survive a curated-data fix (e.g. Simplified -> Traditional).
 */
export interface CardPatch {
  front?: string
  back?: string
  readings?: Record<string, string>
  /** Replaces the whole payload bag when given (merge by key at the caller). */
  payload?: Record<string, unknown>
  /** Replaces the whole metadata bag when given (merge by key at the caller). */
  metadata?: CardMetadata
}

export function updateCard(db: Db, cardId: string, userId: string, patch: CardPatch): void {
  const row = db.select().from(cards).where(eq(cards.id, cardId)).get()
  if (!row || row.userId !== userId) return
  const set = cardSet(patch)
  if (Object.keys(set).length > 0) db.update(cards).set(set).where(eq(cards.id, cardId)).run()
}

function cardSet(patch: CardPatch): Partial<typeof cards.$inferInsert> {
  const set: Partial<typeof cards.$inferInsert> = {}
  if (patch.front !== undefined) set.front = patch.front
  if (patch.back !== undefined) set.back = patch.back
  if (patch.readings !== undefined) set.readingsJson = JSON.stringify(patch.readings)
  if (patch.payload !== undefined) set.payloadJson = JSON.stringify(patch.payload)
  if (patch.metadata !== undefined) set.metadataJson = JSON.stringify(patch.metadata)
  return set
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function toCard(row: typeof cards.$inferSelect): Card {
  return {
    id: row.id,
    deckId: row.deckId,
    type: row.type as CardType,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    front: row.front,
    back: row.back,
    readings: parseJson<Record<string, string>>(row.readingsJson, {}),
    tags: parseJson<string[]>(row.tagsJson, []),
    payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
    metadata: parseJson<CardMetadata>(row.metadataJson, {}),
    origin: row.origin as Card['origin'],
    createdAt: row.createdAt,
  }
}

export function listCards(db: Db, userId: string, deckId?: string): Card[] {
  const where = deckId
    ? and(eq(cards.userId, userId), eq(cards.deckId, deckId))
    : eq(cards.userId, userId)
  // rowid order == insertion order, which is the syllabus (frequency) order.
  const rows = db
    .select()
    .from(cards)
    .where(where)
    .orderBy(sql`rowid asc`)
    .all()
  return rows.map(toCard)
}

export function getCard(db: Db, cardId: string, userId: string): Card | undefined {
  // The user filter lives in SQL, so another user's card id resolves to nothing
  // rather than being fetched and then discarded.
  const row = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .get()
  return row ? toCard(row) : undefined
}

/** Picks a card, preferring ones the learner has reviewed least. */
export function pickCard(db: Db, userId: string, deckId?: string): Card | undefined {
  const least = sql<number>`(select count(*) from ${reviews} r where r.card_id = ${cards.id})`
  const where = deckId
    ? and(eq(cards.userId, userId), eq(cards.deckId, deckId))
    : eq(cards.userId, userId)
  const row = db
    .select()
    .from(cards)
    .where(where)
    .orderBy(asc(least), sql`random()`)
    .limit(1)
    .get()
  return row ? toCard(row) : undefined
}

/**
 * Wrong answers for multiple-choice: other cards' target text.
 *
 * Only words the learner has already met are eligible — the ones they were
 * introduced to (the teach step) or have reviewed. A choice among four strings
 * the learner has never seen is a guess, not recall, so an unseen word is never
 * offered as a distractor. The pool can therefore be small (or empty) early on;
 * the multiple-choice exercise gates itself on having at least one.
 */
export function otherBacks(
  db: Db,
  userId: string,
  targetLang: string,
  excludeBack: string,
  limit = 3,
): string[] {
  return db
    .selectDistinct({ back: cards.back })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.targetLang, targetLang), metCondition()))
    .orderBy(sql`random()`)
    .limit(limit + 1)
    .all()
    .map((r) => r.back)
    .filter((b) => b !== excludeBack)
    .slice(0, limit)
}

/** The learner has met a card when they have reviewed it or hold SRS state for it. */
function metCondition() {
  return sql`(
    exists (select 1 from ${reviews} where ${reviews.cardId} = ${cards.id} and ${reviews.userId} = ${cards.userId})
    or exists (select 1 from ${srs} where ${srs.cardId} = ${cards.id} and ${srs.userId} = ${cards.userId})
  )`
}
