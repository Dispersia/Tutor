import type { UserId, GearInstanceId, GearSetId } from '../../ids'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

export const gearInstances = sqliteTable(
  'gear_instances',
  {
    id: text('id').$type<GearInstanceId>().primaryKey(),
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    slot: text('slot').notNull(),
    quality: text('quality').notNull().default('common'),
    statsJson: text('stats_json').notNull().default('{}'),
    enchantJson: text('enchant_json').notNull().default('[]'),
    armour: integer('armour').notNull().default(0),
    power: integer('power').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_gear_instances_user').on(t.userId, t.itemId)],
)

export const equipment = sqliteTable(
  'equipment',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slot: text('slot').notNull(),
    itemId: text('item_id').notNull(),
    instanceId: text('instance_id').$type<GearInstanceId>(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slot] })],
)

export const gearSets = sqliteTable(
  'gear_sets',
  {
    id: text('id').$type<GearSetId>().primaryKey(),
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    combatStyle: text('combat_style').notNull().default('general'),
    slotsJson: text('slots_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_gear_sets_user').on(t.userId)],
)
