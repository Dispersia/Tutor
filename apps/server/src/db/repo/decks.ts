/** Decks: creation, listing, settings and deletion. */

import { and, asc, eq, inArray, like, sql } from 'drizzle-orm'
import {
  DECK_INSTRUCTION_KEY,
  mergeDeckSettings,
  parseDeckSettings,
  type DeckSettings,
} from '../../deck/settings'
import type { Db } from '../client'
import { attempts, cards, decks, lessonProgress, messages, reviews, sessions, srs } from '../schema'
import { id } from './helpers'
import { getUserSetting } from './settings'

export interface NewDeck {
  name: string
  sourceLang: string
  targetLang: string
  level?: string
  description?: string
  settings?: DeckSettings
}

export function createDeck(db: Db, userId: string, d: NewDeck) {
  const row = {
    id: id(),
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

export function listDecks(db: Db, userId: string) {
  return db
    .select({
      id: decks.id,
      name: decks.name,
      sourceLang: decks.sourceLang,
      targetLang: decks.targetLang,
      level: decks.level,
      description: decks.description,
      settingsJson: decks.settingsJson,
      cardCount: sql<number>`count(${cards.id})`,
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .where(eq(decks.userId, userId))
    .groupBy(decks.id)
    .orderBy(asc(decks.name))
    .all()
    .map((d) => ({ ...d, settings: parseDeckSettings(d.settingsJson) }))
}

export function getDeck(db: Db, deckId: string, userId: string) {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  if (!row || row.userId !== userId) return undefined
  return { ...row, settings: parseDeckSettings(row.settingsJson) }
}

/**
 * The prompt to reuse for new decks and growth batches. The learner's saved
 * prompt wins; older decks predate that setting, so fall back to the first
 * explicit (non-generic) prompt already stored on one of their decks.
 */
export function rememberedDeckInstruction(db: Db, userId: string): string | undefined {
  const saved = getUserSetting(db, userId, DECK_INSTRUCTION_KEY)
  if (saved) return saved
  for (const deck of listDecks(db, userId)) {
    const prompt = deck.settings.instruction
    if (prompt && !prompt.startsWith('Build a deck from the imported deck ')) return prompt
  }
  return undefined
}

/** The stable key a deck's lessons are addressed by (level if set, else id). */
export function deckKey(deck: { id: string; level: string | null }): string {
  return deck.level ?? deck.id
}

/** Applies a partial settings update and returns the merged settings. */
export function updateDeckSettings(
  db: Db,
  deckId: string,
  userId: string,
  patch: Partial<DeckSettings>,
): DeckSettings | undefined {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  if (!row || row.userId !== userId) return undefined
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
 * Deletes a deck and everything that belongs to it: its cards, the learner's
 * SRS state, attempt/review history, lesson progress, and any deck-scoped chat
 * sessions. Other users' rows are never touched.
 */
export function deleteDeck(db: Db, deckId: string, userId: string): void {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  if (!row || row.userId !== userId) return

  const cardIds = db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .all()
    .map((c) => c.id)

  if (cardIds.length > 0) {
    db.delete(srs)
      .where(and(eq(srs.userId, userId), inArray(srs.cardId, cardIds)))
      .run()
    db.delete(reviews)
      .where(and(eq(reviews.userId, userId), inArray(reviews.cardId, cardIds)))
      .run()
    db.delete(attempts)
      .where(and(eq(attempts.userId, userId), inArray(attempts.cardId, cardIds)))
      .run()
  }

  // Lessons are addressed as `${deck.level ?? deck.id}:${step}`.
  const key = row.level ?? row.id
  db.delete(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), like(lessonProgress.lessonId, `${key}:%`)))
    .run()

  const sessionIds = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.deckId, deckId)))
    .all()
    .map((s) => s.id)
  if (sessionIds.length > 0) {
    db.delete(messages).where(inArray(messages.sessionId, sessionIds)).run()
  }
  db.delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.deckId, deckId)))
    .run()

  db.delete(cards).where(eq(cards.deckId, deckId)).run()
  db.delete(decks).where(eq(decks.id, deckId)).run()
}
