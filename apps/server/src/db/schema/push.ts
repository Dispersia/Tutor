/**
 * Web Push subscriptions (docs/DESIGN.md §13.5.1). Part of the schema split
 * (docs/ARCHITECTURE.md).
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

/**
 * One row per installed device that opted in to alerts. `endpoint` is the push
 * service URL; `p256dh`/`auth` are the subscription's public key and auth secret
 * (RFC 8291).
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
    lastOkAt: integer('last_ok_at'),
  },
  (t) => [index('idx_push_subscriptions_user').on(t.userId)],
)
