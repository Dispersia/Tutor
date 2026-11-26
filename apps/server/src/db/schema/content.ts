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
  settingsJson: text('settings_json').notNull().default('{}'),
})

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').$type<CardId>().primaryKey(),
    deckId: text('deck_id')
      .$type<DeckId>()
      .references(() => decks.id),
    privateTo: text('private_to').$type<UserId>(),
    type: text('type').notNull(),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    readingsJson: text('readings_json').notNull().default('{}'),
    tagsJson: text('tags_json').notNull().default('[]'),
    payloadJson: text('payload_json').notNull().default('{}'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    origin: text('origin').notNull().default('manual'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_cards_deck').on(t.deckId)],
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
  createdAt: integer('created_at').notNull(),
})
