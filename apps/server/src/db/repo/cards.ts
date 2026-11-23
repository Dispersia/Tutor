/**
 * Cards: creation, edits and the read queries practice and review share.
 *
 * Cards are shared with their deck (see `decks.ts`) — except a card marked
 * `private_to` one member, which only that member's queries return. `userId`
 * below is the member asking: with it a query returns the shared cards plus
 * that member's own; without it (tools, the recorder) it returns every card.
 */

import type { UserId, DeckId, CardId } from '../../ids'
import type { Card, CardMetadata, CardType } from '@tutor/core'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { cards, reviews, srs } from '../schema'
import { newId, now } from './helpers'

export interface NewCard {
  deckId: DeckId
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
  /** Only this member sees the card (their reinforcement cards). */
  privateTo?: UserId
}

/** The cards a member may see: the shared ones and their own private ones. */
function visibleTo(userId: UserId | undefined) {
  return userId ? or(isNull(cards.privateTo), eq(cards.privateTo, userId)) : undefined
}

export function addCard(db: Db, userId: UserId, c: NewCard) {
  const row = cardRow(userId, c)
  db.insert(cards).values(row).run()
  return row
}

function cardRow(userId: UserId, c: NewCard) {
  return {
    id: newId<CardId>(),
    deckId: c.deckId,
    userId,
    privateTo: c.privateTo ?? null,
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

export function updateCard(db: Db, cardId: CardId, patch: CardPatch): void {
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

/**
 * A card as the server holds it: the shared `Card` with its ids branded, so a
 * card read from the database can be passed wherever a `CardId` is wanted.
 */
export type ServerCard = Card & { id: CardId; deckId: DeckId | null }

function toCard(row: typeof cards.$inferSelect): ServerCard {
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

/** A deck's cards (or every deck's, when none is named) as `userId` sees them. */
export function listCards(db: Db, userId?: UserId, deckId?: DeckId): ServerCard[] {
  const where = and(deckId ? eq(cards.deckId, deckId) : undefined, visibleTo(userId))
  // rowid order == insertion order, which is the syllabus (frequency) order.
  const rows = db
    .select()
    .from(cards)
    .where(where)
    .orderBy(sql`rowid asc`)
    .all()
  return rows.map(toCard)
}

export function getCard(db: Db, cardId: CardId, userId?: UserId): ServerCard | undefined {
  const row = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), visibleTo(userId)))
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
  userId: UserId,
  targetLang: string,
  excludeBack: string,
  limit = 3,
): string[] {
  return db
    .selectDistinct({ back: cards.back })
    .from(cards)
    .where(and(eq(cards.targetLang, targetLang), visibleTo(userId), metCondition(userId)))
    .orderBy(sql`random()`)
    .limit(limit + 1)
    .all()
    .map((r) => r.back)
    .filter((b) => b !== excludeBack)
    .slice(0, limit)
}

/** This learner has met a card when they have reviewed it or hold SRS state for it. */
function metCondition(userId: UserId) {
  return sql`(
    exists (select 1 from ${reviews} where ${reviews.cardId} = ${cards.id} and ${reviews.userId} = ${userId})
    or exists (select 1 from ${srs} where ${srs.cardId} = ${cards.id} and ${srs.userId} = ${userId})
  )`
}

/** Every target language any member's card uses this exact `back` text in. */
export function cardLanguages(db: Db, back: string): string[] {
  return db
    .selectDistinct({ lang: cards.targetLang })
    .from(cards)
    .where(eq(cards.back, back))
    .all()
    .map((r) => r.lang)
}
