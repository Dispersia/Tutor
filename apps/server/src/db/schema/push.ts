import type { UserId } from '../../ids'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .$type<UserId>()
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
