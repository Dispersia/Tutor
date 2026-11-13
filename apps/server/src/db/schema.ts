import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * SQLite schema (docs/DESIGN.md §12). Cards carry a JSON payload so new card
 * types need no migration. History tables are append-only.
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull(),
  nativeLang: text('native_lang').notNull().default('en'),
  settingsJson: text('settings_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
})

export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceLang: text('source_lang').notNull(),
  targetLang: text('target_lang').notNull(),
  level: text('level'),
  description: text('description'),
})

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').references(() => decks.id),
    type: text('type').notNull(),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    readingsJson: text('readings_json').notNull().default('{}'),
    tagsJson: text('tags_json').notNull().default('[]'),
    payloadJson: text('payload_json').notNull().default('{}'),
    origin: text('origin').notNull().default('manual'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_cards_deck').on(t.deckId)],
)

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  deckId: text('deck_id'),
  kind: text('kind').notNull().default('chat'),
  lang: text('lang'),
  title: text('title'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
})

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
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

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  cardId: text('card_id'),
  userId: text('user_id'),
  exerciseId: text('exercise_id'),
  score: real('score'),
  latencyMs: integer('latency_ms'),
  detailJson: text('detail_json').notNull().default('{}'),
  audioRef: text('audio_ref'),
  createdAt: integer('created_at').notNull(),
})

export const attempts = sqliteTable('attempts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  cardId: text('card_id'),
  exerciseId: text('exercise_id'),
  answerJson: text('answer_json').notNull().default('{}'),
  gradeJson: text('grade_json').notNull().default('{}'),
  score: real('score'),
  createdAt: integer('created_at').notNull(),
})

export const xpEvents = sqliteTable('xp_events', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  sourceId: text('source_id'),
  createdAt: integer('created_at').notNull(),
})

export const stats = sqliteTable('stats', {
  userId: text('user_id').primaryKey(),
  xpTotal: integer('xp_total').notNull().default(0),
  level: integer('level').notNull().default(1),
  streakDays: integer('streak_days').notNull().default(0),
  lastActiveDay: text('last_active_day'),
  dailyGoal: integer('daily_goal').notNull().default(50),
  updatedAt: integer('updated_at').notNull(),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const audioBlobs = sqliteTable('audio_blobs', {
  hash: text('hash').primaryKey(),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  mime: text('mime'),
  seconds: real('seconds'),
  createdAt: integer('created_at').notNull(),
})
