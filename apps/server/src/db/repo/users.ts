/** User accounts. */

import { eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { users } from '../schema'
import { id, now } from './helpers'

export interface NewUser {
  username: string
  passwordHash?: string
  handle?: string
  role?: 'admin' | 'user'
  nativeLang?: string
  targetLang?: string
  level?: string
}

export interface PublicUser {
  id: string
  username: string | null
  handle: string
  role: string
  nativeLang: string
  targetLang: string | null
  level: string | null
  createdAt: number
}

export function publicUser(u: typeof users.$inferSelect): PublicUser {
  return {
    id: u.id,
    username: u.username,
    handle: u.handle,
    role: u.role,
    nativeLang: u.nativeLang,
    targetLang: u.targetLang,
    level: u.level,
    createdAt: u.createdAt,
  }
}

export function createUser(db: Db, u: NewUser) {
  const row = {
    id: id(),
    username: u.username,
    passwordHash: u.passwordHash ?? null,
    handle: u.handle ?? u.username,
    role: u.role ?? 'user',
    nativeLang: u.nativeLang ?? 'en',
    targetLang: u.targetLang ?? null,
    level: u.level ?? null,
    settingsJson: '{}',
    createdAt: now(),
    updatedAt: now(),
  }
  db.insert(users).values(row).run()
  return row
}

export function getUserById(db: Db, uid: string) {
  return db.select().from(users).where(eq(users.id, uid)).get()
}

export function getUserByUsername(db: Db, username: string) {
  return db.select().from(users).where(eq(users.username, username)).get()
}

export function listUsers(db: Db) {
  return db.select().from(users).orderBy(users.createdAt).all().map(publicUser)
}

/** How many accounts exist — a `COUNT(*)`, never a full table load. */
export function countUsers(db: Db): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .get()
  return Number(row?.n ?? 0)
}

export function updateUser(
  db: Db,
  uid: string,
  patch: Partial<{ handle: string; nativeLang: string; targetLang: string; level: string }>,
): void {
  db.update(users)
    .set({ ...patch, updatedAt: now() })
    .where(eq(users.id, uid))
    .run()
}

export function deleteUser(db: Db, uid: string): void {
  db.delete(users).where(eq(users.id, uid)).run()
}
