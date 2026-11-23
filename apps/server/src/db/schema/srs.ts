/**
 * Spaced-repetition state and its append-only review log (docs/DESIGN.md §13.6).
 * Part of the schema split (docs/ARCHITECTURE.md).
 */

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

/** Per-user spaced-repetition state (FSRS-6, one row per card reviewed). */
export const srs = sqliteTable(
  'srs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
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
  (t) => [index('idx_srs_user').on(t.userId)],
)

/**
 * Append-only FSRS review log: every review that moved a schedule, practice and
 * combat alike. Enough history to replay a card (`rating` + `elapsed_days`) under
 * a future model (FSRS-7) or to train per-user weights later.
 */
export const srsReviews = sqliteTable(
  'srs_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
    /** The FSRS grade (1 = Again … 4 = Easy) this review produced. */
    rating: integer('rating').notNull(),
    stateBefore: text('state_before').notNull(),
    stateAfter: text('state_after').notNull(),
    stabilityBefore: real('stability_before').notNull(),
    stabilityAfter: real('stability_after').notNull(),
    difficultyBefore: real('difficulty_before').notNull(),
    difficultyAfter: real('difficulty_after').notNull(),
    intervalDays: real('interval_days').notNull(),
    /** Days since the previous review; fractional for same-day reviews. */
    elapsedDays: real('elapsed_days').notNull(),
    /** The desired retention in force when this review was scheduled. */
    desiredRetention: real('desired_retention').notNull(),
    dueAt: integer('due_at').notNull(),
    /** Which surface fed the schedule: `practice` or `combat`. */
    source: text('source').notNull().default('practice'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_srs_reviews_card').on(t.userId, t.cardId, t.createdAt)],
)
