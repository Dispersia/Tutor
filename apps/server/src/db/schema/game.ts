/**
 * The game economy: action progress + idle rigs, the gather log, the materials
 * bank, talents and combat state (docs/DESIGN.md §13.5). Part of the schema split
 * (docs/ARCHITECTURE.md).
 */

import type { UserId } from '../../ids'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

/**
 * Per-user **action** levels (docs/DESIGN.md §13.5). The level lives on the
 * action (`Mine copper`), not the profession; a profession's level is the sum of
 * its actions' levels and is derived, never stored.
 *
 * The row also carries the action's **idle rig** (§13.5.1): `completions` is how
 * many drills it has ever completed (which sets the run's speed and length),
 * `runEndsAt`/`settledAt` are the run's two timestamps, and `crafts`/`remainder`
 * are the fractional carry that keeps settlement exact. There is no timer — the
 * whole accrual is a closed-form function of these numbers and the clock.
 */
export const actionProgress = sqliteTable(
  'action_progress',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: text('action_id').notNull(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(1),
    /** lifetime drill completions — drives the rig's interval and run length */
    completions: integer('completions').notNull().default(0),
    /** ms; the rig runs while `now < run_ends_at` (0 = still) */
    runEndsAt: integer('run_ends_at').notNull().default(0),
    /** ms; accrual has been credited up to here */
    settledAt: integer('settled_at').notNull().default(0),
    /** fractional crafts carried between settles (keeps `consumes` integral) */
    crafts: real('crafts').notNull().default(0),
    /** fractional produced items per item id, as JSON */
    remainderJson: text('remainder_json').notNull().default('{}'),
    /**
     * ms; the run deadline whose "30 minutes left" alert was already sent. A drill
     * that extends the run moves `run_ends_at`, re-arming the alert (§13.5.1).
     */
    notifiedEndsAt: integer('notified_ends_at').notNull().default(0),
    /** the recipe choice this action's rig runs ('' = the first choice) */
    lastChoice: text('last_choice').notNull().default(''),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.actionId] })],
)

/**
 * Append-only completion log (docs/DESIGN.md §13.5.1) — one row per drill that
 * powered a rig. The live rig is an O(1) accumulator; this log exists so the bank
 * stays reconstructible from *when things were completed* alone, and so the idle
 * curve can be rebalanced later without rewriting anyone's materials.
 */
export const gatherLog = sqliteTable(
  'gather_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: text('action_id').notNull(),
    completions: integer('completions').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_gather_log_user_action').on(t.userId, t.actionId, t.createdAt)],
)

/** Per-user materials bank. */
export const inventory = sqliteTable(
  'inventory',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
)

/** Per-user talents (one choice per 10-level milestone). */
export const talents = sqliteTable(
  'talents',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    talentId: text('talent_id').notNull(),
    skillId: text('skill_id').notNull(),
    tier: text('tier').notNull(),
    milestone: integer('milestone').notNull(),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.talentId] })],
)

/** Persistent combat state (docs/DESIGN.md §13.5). */
export const playerState = sqliteTable('player_state', {
  userId: text('user_id')
    .$type<UserId>()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hp: integer('hp'),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * The player's active combat encounter (one at a time). HP carries between
 * fights — damage you take stays with you and only food/potions heal it.
 */
export const encounters = sqliteTable('encounters', {
  userId: text('user_id')
    .$type<UserId>()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  monsterId: text('monster_id').notNull(),
  monsterHp: integer('monster_hp').notNull(),
  playerHp: integer('player_hp').notNull(),
  playerMaxHp: integer('player_max_hp').notNull().default(0),
  /** The scaled monster's stats for this fight (0 = use the base definition). */
  monsterMaxHp: integer('monster_max_hp').notNull().default(0),
  monsterDamage: integer('monster_damage').notNull().default(0),
  monsterLevel: integer('monster_level').notNull().default(0),
  xpReward: integer('xp_reward').notNull().default(0),
  powerBonus: real('power_bonus').notNull().default(0),
  potionId: text('potion_id'),
  foodEaten: integer('food_eaten').notNull().default(0),
  totalDamage: integer('total_damage').notNull().default(0),
  xpEarned: integer('xp_earned').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
