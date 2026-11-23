/**
 * Crafted gear and loadouts (docs/DESIGN.md §13.5.3). Part of the schema split
 * (docs/REFACTOR_PLAN.md §8.2, Phase 11).
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

/**
 * Crafted gear instances. A recipe produces a *piece*, not a stack: each row
 * carries its own quality and rolled stats. The inventory count stays the
 * stack count, so the bank and the old equipment code keep working.
 */
export const gearInstances = sqliteTable(
  'gear_instances',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    slot: text('slot').notNull(),
    quality: text('quality').notNull().default('common'),
    statsJson: text('stats_json').notNull().default('{}'),
    /** JSON array of band ids enchanted onto this piece (docs §13.5.3). */
    enchantJson: text('enchant_json').notNull().default('[]'),
    armour: integer('armour').notNull().default(0),
    power: integer('power').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_gear_instances_user').on(t.userId, t.itemId)],
)

/** Equipped gear, one item per slot. `instance_id` points at a crafted roll. */
export const equipment = sqliteTable(
  'equipment',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slot: text('slot').notNull(),
    itemId: text('item_id').notNull(),
    instanceId: text('instance_id'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_equipment_user').on(t.userId)],
)

/** Saved gear sets for quick loadout changes. */
export const gearSets = sqliteTable(
  'gear_sets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    combatStyle: text('combat_style').notNull().default('general'),
    /** JSON: slot → { itemId, instanceId? } */
    slotsJson: text('slots_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_gear_sets_user').on(t.userId)],
)
