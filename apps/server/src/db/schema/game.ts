import type { UserId } from '../../ids'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

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
    completions: integer('completions').notNull().default(0),
    runEndsAt: integer('run_ends_at').notNull().default(0),
    runStartedAt: integer('run_started_at').notNull().default(0),
    settledAt: integer('settled_at').notNull().default(0),
    crafts: real('crafts').notNull().default(0),
    remainderJson: text('remainder_json').notNull().default('{}'),
    notifiedEndsAt: integer('notified_ends_at').notNull().default(0),
    lastChoice: text('last_choice').notNull().default(''),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.actionId] })],
)

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
  },
  (t) => [primaryKey({ columns: [t.userId, t.talentId] })],
)

export const playerState = sqliteTable('player_state', {
  userId: text('user_id')
    .$type<UserId>()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hp: integer('hp'),
  updatedAt: integer('updated_at').notNull(),
})

export const encounters = sqliteTable('encounters', {
  userId: text('user_id')
    .$type<UserId>()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  monsterId: text('monster_id').notNull(),
  monsterHp: integer('monster_hp').notNull(),
  playerHp: integer('player_hp').notNull(),
  playerMaxHp: integer('player_max_hp').notNull().default(0),
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
