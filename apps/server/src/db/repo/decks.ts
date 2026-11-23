/**
 * Decks: creation, listing, settings and deletion.
 *
 * Decks and their cards are **shared by every member** (docs/DESIGN.md §12.5).
 * `decks.user_id` only records who created the deck; what is personal — the
 * schedule, review history and lesson progress — lives in the per-user tables.
 * So nothing here asks who is calling: a deck has no owner to check.
 */

import type { UserId, DeckId, CardId } from '../../ids'
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import {
  DECK_INSTRUCTION_KEY,
  mergeDeckSettings,
  parseDeckSettings,
  type DeckSettings,
} from '../../deck/settings'
import type { Db } from '../client'
import {
  attempts,
  cards,
  decks,
  lessonProgress,
  messages,
  reviews,
  sessions,
  srs,
  srsReviews,
} from '../schema'
import { inTransaction, newId } from './helpers'
import { getUserSetting } from './settings'

export interface NewDeck {
  name: string
  sourceLang: string
  targetLang: string
  level?: string
  description?: string
  settings?: DeckSettings
}

export function createDeck(db: Db, userId: UserId, d: NewDeck) {
  const row = {
    id: newId<DeckId>(),
    userId,
    name: d.name,
    sourceLang: d.sourceLang,
    targetLang: d.targetLang,
    level: d.level ?? null,
    description: d.description ?? null,
    settingsJson: JSON.stringify(d.settings ?? {}),
  }
  db.insert(decks).values(row).run()
  return row
}

const DECK_COLUMNS = {
  id: decks.id,
  name: decks.name,
  sourceLang: decks.sourceLang,
  targetLang: decks.targetLang,
  level: decks.level,
  description: decks.description,
  settingsJson: decks.settingsJson,
  cardCount: sql<number>`count(${cards.id})`,
}

/** Every deck, for any member. */
export function listDecks(db: Db) {
  return (
    db
      .select(DECK_COLUMNS)
      .from(decks)
      // The count is the shared deck: a member's private cards are not part of it.
      .leftJoin(cards, and(eq(cards.deckId, decks.id), isNull(cards.privateTo)))
      .groupBy(decks.id)
      .orderBy(asc(decks.name))
      .all()
      .map((d) => ({ ...d, settings: parseDeckSettings(d.settingsJson) }))
  )
}

export function getDeck(db: Db, deckId: DeckId) {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  if (!row) return undefined
  return { ...row, settings: parseDeckSettings(row.settingsJson) }
}

/**
 * The prompt to reuse for new decks and growth batches. The learner's saved
 * prompt wins; older decks predate that setting, so fall back to the first
 * explicit (non-generic) prompt already stored on one of their decks.
 */
export function rememberedDeckInstruction(db: Db, userId: UserId): string | undefined {
  const saved = getUserSetting(db, userId, DECK_INSTRUCTION_KEY)
  if (saved) return saved
  for (const deck of listDecks(db)) {
    const prompt = deck.settings.instruction
    if (prompt && !prompt.startsWith('Build a deck from the imported deck ')) return prompt
  }
  return undefined
}

/**
 * The stable key a deck's lessons are addressed by: its id. Never the free-text
 * `level` — two decks with one level would share lesson ids and progress.
 */
export function deckKey(deck: { id: string }): string {
  return deck.id
}

/** Applies a partial settings update and returns the merged settings. */
export function updateDeckSettings(
  db: Db,
  deckId: DeckId,
  patch: Partial<DeckSettings>,
): DeckSettings | undefined {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  if (!row) return undefined
  const merged = mergeDeckSettings(parseDeckSettings(row.settingsJson), patch)
  db.update(decks)
    .set({ settingsJson: JSON.stringify(merged) })
    .where(eq(decks.id, deckId))
    .run()
  return merged
}

/**
 * Clears the `building` flag a deck carries when a background build did not
 * finish (a process restart mid-build). Its cards up to the growth cursor stay;
 * the deck simply stops claiming to be building.
 */
export function clearDeckBuilds(db: Db): number {
  let cleared = 0
  for (const row of db.select().from(decks).all()) {
    const settings = parseDeckSettings(row.settingsJson)
    if (!settings.building) continue
    db.update(decks)
      .set({ settingsJson: JSON.stringify({ ...settings, building: false }) })
      .where(eq(decks.id, row.id))
      .run()
    cleared++
  }
  return cleared
}

/**
 * Deletes a deck for **everyone**, in one transaction: its cards, every
 * member's schedule and history for those cards, their lesson progress and any
 * deck-scoped chat sessions.
 */
export function deleteDeck(db: Db, deckId: DeckId): void {
  inTransaction(db, (tx) => {
    deleteCardHistory(tx, cardIdsOf(tx, deckId))
    // Lessons are addressed as `${deck.id}:${step}`; a deck id has no LIKE wildcards.
    tx.delete(lessonProgress)
      .where(like(lessonProgress.lessonId, `${deckId}:%`))
      .run()
    deleteDeckSessions(tx, deckId)
    tx.delete(cards).where(eq(cards.deckId, deckId)).run()
    tx.delete(decks).where(eq(decks.id, deckId)).run()
  })
}

/** Deletes every deck. Only for when the last member is gone: nobody is left to study them. */
export function deleteAllDecks(db: Db): void {
  for (const d of db.select({ id: decks.id }).from(decks).all()) deleteDeck(db, d.id)
}

function cardIdsOf(db: Db, deckId: DeckId): CardId[] {
  return db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .all()
    .map((c) => c.id)
}

/** Every member's SRS state, review log, review and attempt rows for these cards. */
function deleteCardHistory(db: Db, cardIds: CardId[]): void {
  // SQLite caps the variables in one statement; a big deck is deleted in slices.
  for (let i = 0; i < cardIds.length; i += 500) {
    const slice = cardIds.slice(i, i + 500)
    db.delete(srs).where(inArray(srs.cardId, slice)).run()
    db.delete(srsReviews).where(inArray(srsReviews.cardId, slice)).run()
    db.delete(reviews).where(inArray(reviews.cardId, slice)).run()
    db.delete(attempts).where(inArray(attempts.cardId, slice)).run()
  }
}

/** The deck-scoped chat sessions (any member's) and all their messages. */
function deleteDeckSessions(db: Db, deckId: DeckId): void {
  const ids = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.deckId, deckId))
    .all()
    .map((s) => s.id)
  if (ids.length > 0) db.delete(messages).where(inArray(messages.sessionId, ids)).run()
  db.delete(sessions).where(eq(sessions.deckId, deckId)).run()
}
