import type { UserId } from '../../ids'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable(
  'users',
  {
    id: text('id').$type<UserId>().primaryKey(),
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
  },
  (t) => [uniqueIndex('idx_users_username').on(t.username)],
)

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('idx_auth_sessions_user').on(t.userId)],
)

export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)
