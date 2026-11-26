import type { UserId, CardId } from '../../ids'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id').$type<CardId>(),
    userId: text('user_id').$type<UserId>(),
    exerciseId: text('exercise_id'),
    score: real('score'),
    latencyMs: integer('latency_ms'),
    detailJson: text('detail_json').notNull().default('{}'),
    audioRef: text('audio_ref'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_reviews_user').on(t.userId), index('idx_reviews_card').on(t.cardId)],
)

export const xpEvents = sqliteTable(
  'xp_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').$type<UserId>(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    sourceId: text('source_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_xp_user').on(t.userId)],
)

export const stats = sqliteTable('stats', {
  userId: text('user_id').$type<UserId>().primaryKey(),
  xpTotal: integer('xp_total').notNull().default(0),
  level: integer('level').notNull().default(1),
  streakDays: integer('streak_days').notNull().default(0),
  lastActiveDay: text('last_active_day'),
  dailyGoal: integer('daily_goal').notNull().default(50),
  updatedAt: integer('updated_at').notNull(),
})

export const lessonProgress = sqliteTable(
  'lesson_progress',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.lessonId] })],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
