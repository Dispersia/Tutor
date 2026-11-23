import type { UserId, CardId } from '../../ids'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

export const srs = sqliteTable(
  'srs',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').$type<CardId>().notNull(),
    state: text('state').notNull().default('new'),
    step: integer('step').notNull().default(0),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    ease: real('ease').notNull().default(2.5),
    intervalDays: real('interval_days').notNull().default(0),
    dueAt: integer('due_at').notNull().default(0),
    lastRating: integer('last_rating'),
    lastReviewAt: integer('last_review_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] })],
)

export const srsReviews = sqliteTable(
  'srs_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').$type<CardId>().notNull(),
    rating: integer('rating').notNull(),
    stateBefore: text('state_before').notNull(),
    stateAfter: text('state_after').notNull(),
    stabilityBefore: real('stability_before').notNull(),
    stabilityAfter: real('stability_after').notNull(),
    difficultyBefore: real('difficulty_before').notNull(),
    difficultyAfter: real('difficulty_after').notNull(),
    intervalDays: real('interval_days').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    desiredRetention: real('desired_retention').notNull(),
    dueAt: integer('due_at').notNull(),
    source: text('source').notNull().default('practice'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_srs_reviews_card').on(t.userId, t.cardId, t.createdAt)],
)
