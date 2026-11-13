import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * SQLite schema (docs/DESIGN.md §12). Cards carry a JSON payload so new card
 * types need no migration. History tables are append-only and scoped by user_id.
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username'),
  passwordHash: text('password_hash'),
  handle: text('handle').notNull(),
  role: text('role').notNull().default('user'),
  nativeLang: text('native_lang').notNull().default('en'),
  targetLang: text('target_lang'),
  level: text('level'),
  settingsJson: text('settings_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('idx_auth_sessions_user').on(t.userId)],
)

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
})

export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
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
    userId: text('user_id'),
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
  (t) => [index('idx_cards_deck').on(t.deckId), index('idx_cards_user').on(t.userId)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    deckId: text('deck_id'),
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
  userId: text('user_id'),
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

/** Server-global settings (registration policy, install metadata). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** Per-user skill levels (docs/DESIGN.md §13.5). */
export const skillProgress = sqliteTable('skill_progress', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull(),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
})

/** Per-user materials bank. */
export const inventory = sqliteTable('inventory', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  count: integer('count').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

/** Per-user talents (5-level choices + 10-level majors). */
export const talents = sqliteTable('talents', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  talentId: text('talent_id').notNull(),
  skillId: text('skill_id').notNull(),
  tier: text('tier').notNull(),
  milestone: integer('milestone').notNull(),
  grantedAt: integer('granted_at').notNull(),
})

/** Equipped gear, one item per slot. */
export const equipment = sqliteTable('equipment', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  slot: text('slot').notNull(),
  itemId: text('item_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Per-user spaced-repetition state (one row per card reviewed). */
export const srs = sqliteTable('srs', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull(),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  ease: real('ease').notNull().default(2.5),
  intervalDays: real('interval_days').notNull().default(0),
  dueAt: integer('due_at').notNull().default(0),
  lastReviewAt: integer('last_review_at'),
})

/** Completed curriculum lessons. */
export const lessonProgress = sqliteTable('lesson_progress', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lessonId: text('lesson_id').notNull(),
  completedAt: integer('completed_at'),
})

/** The player's active combat encounter (one at a time). */
export const encounters = sqliteTable('encounters', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  monsterId: text('monster_id').notNull(),
  monsterHp: integer('monster_hp').notNull(),
  playerHp: integer('player_hp').notNull(),
  playerMaxHp: integer('player_max_hp').notNull().default(0),
  powerBonus: real('power_bonus').notNull().default(0),
  potionId: text('potion_id'),
  foodEaten: integer('food_eaten').notNull().default(0),
  totalDamage: integer('total_damage').notNull().default(0),
  xpEarned: integer('xp_earned').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const audioBlobs = sqliteTable('audio_blobs', {
  hash: text('hash').primaryKey(),
  userId: text('user_id'),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  mime: text('mime'),
  seconds: real('seconds'),
  createdAt: integer('created_at').notNull(),
})
