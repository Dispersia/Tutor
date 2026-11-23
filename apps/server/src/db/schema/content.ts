/**
 * Decks, cards, chat sessions and messages, plus stored audio (docs/DESIGN.md
 * §12). Cards carry a JSON payload so new card types need no migration. Part of
 * the schema split (docs/ARCHITECTURE.md).
 */

import type { UserId, DeckId, CardId, SessionId } from '../../ids'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const decks = sqliteTable('decks', {
  id: text('id').$type<DeckId>().primaryKey(),
  userId: text('user_id').$type<UserId>(),
  name: text('name').notNull(),
  sourceLang: text('source_lang').notNull(),
  targetLang: text('target_lang').notNull(),
  level: text('level'),
  description: text('description'),
  /** Deck-level overrides (ruby/reading rules, character variant, toggles). */
  settingsJson: text('settings_json').notNull().default('{}'),
})

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').$type<CardId>().primaryKey(),
    deckId: text('deck_id')
      .$type<DeckId>()
      .references(() => decks.id),
    userId: text('user_id').$type<UserId>(),
    /** Set for a card only one member sees (their reinforcement cards); null = shared. */
    privateTo: text('private_to').$type<UserId>(),
    type: text('type').notNull(),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    readingsJson: text('readings_json').notNull().default('{}'),
    tagsJson: text('tags_json').notNull().default('[]'),
    payloadJson: text('payload_json').notNull().default('{}'),
    /** Language-agnostic annotations (pitch accent, radicals, …) — see core metadata. */
    metadataJson: text('metadata_json').notNull().default('{}'),
    origin: text('origin').notNull().default('manual'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_cards_deck').on(t.deckId), index('idx_cards_user').on(t.userId)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').$type<SessionId>().primaryKey(),
    userId: text('user_id').$type<UserId>(),
    deckId: text('deck_id').$type<DeckId>(),
    kind: text('kind').notNull().default('chat'),
    lang: text('lang'),
    title: text('title'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [index('idx_sessions_user').on(t.userId)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    text: text('text').notNull().default(''),
    audioRef: text('audio_ref'),
    model: text('model'),
    tokensIn: integer('tokens_in').default(0),
    tokensOut: integer('tokens_out').default(0),
    costUsd: real('cost_usd').default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_messages_session').on(t.sessionId)],
)

export const audioBlobs = sqliteTable('audio_blobs', {
  hash: text('hash').primaryKey(),
  userId: text('user_id').$type<UserId>(),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  mime: text('mime'),
  seconds: real('seconds'),
  createdAt: integer('created_at').notNull(),
})
