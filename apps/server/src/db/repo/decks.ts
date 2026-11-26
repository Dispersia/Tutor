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

export function listDecks(db: Db, userId?: UserId) {
  return db
    .select(DECK_COLUMNS)
    .from(decks)
    .leftJoin(cards, and(eq(cards.deckId, decks.id), isNull(cards.privateTo)))
    .where(userId ? eq(decks.userId, userId) : undefined)
    .groupBy(decks.id)
    .orderBy(asc(decks.name))
    .all()
    .map((d) => ({ ...d, settings: parseDeckSettings(d.settingsJson) }))
}

export function getDeck(db: Db, deckId: DeckId, userId?: UserId) {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  if (!row) return undefined
  if (userId && row.userId !== userId) return undefined
  return { ...row, settings: parseDeckSettings(row.settingsJson) }
}

export function rememberedDeckInstruction(db: Db, userId: UserId): string | undefined {
  const saved = getUserSetting(db, userId, DECK_INSTRUCTION_KEY)
  if (saved) return saved
  for (const deck of listDecks(db, userId)) {
    const prompt = deck.settings.instruction
    if (prompt && !prompt.startsWith('Build a deck from the imported deck ')) return prompt
  }
  return undefined
}

export function deckKey(deck: { id: string }): string {
  return deck.id
}

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

export function deleteDeck(db: Db, deckId: DeckId): void {
  inTransaction(db, (tx) => {
    deleteCardHistory(tx, cardIdsOf(tx, deckId))
    tx.delete(lessonProgress)
      .where(like(lessonProgress.lessonId, `${deckId}:%`))
      .run()
    deleteDeckSessions(tx, deckId)
    tx.delete(cards).where(eq(cards.deckId, deckId)).run()
    tx.delete(decks).where(eq(decks.id, deckId)).run()
  })
}

export function deleteAllDecks(db: Db): void {
  for (const d of db.select({ id: decks.id }).from(decks).all()) deleteDeck(db, d.id)
}

export function deleteCards(db: Db, cardIds: CardId[]): void {
  if (cardIds.length === 0) return
  inTransaction(db, (tx) => {
    deleteCardHistory(tx, cardIds)
    for (let i = 0; i < cardIds.length; i += 500) {
      tx.delete(cards)
        .where(inArray(cards.id, cardIds.slice(i, i + 500)))
        .run()
    }
  })
}

function cardIdsOf(db: Db, deckId: DeckId): CardId[] {
  return db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .all()
    .map((c) => c.id)
}

function deleteCardHistory(db: Db, cardIds: CardId[]): void {
  for (let i = 0; i < cardIds.length; i += 500) {
    const slice = cardIds.slice(i, i + 500)
    db.delete(srs).where(inArray(srs.cardId, slice)).run()
    db.delete(srsReviews).where(inArray(srsReviews.cardId, slice)).run()
    db.delete(reviews).where(inArray(reviews.cardId, slice)).run()
    db.delete(attempts).where(inArray(attempts.cardId, slice)).run()
  }
}

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
