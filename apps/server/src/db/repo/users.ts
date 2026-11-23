/** User accounts. */

import type { UserId } from '../../ids'
import { eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import {
  attempts,
  audioBlobs,
  cards,
  decks,
  messages,
  reviews,
  sessions,
  stats,
  users,
  xpEvents,
} from '../schema'
import { deleteAllDecks } from './decks'
import { inTransaction, newId, now } from './helpers'

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
  id: UserId
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
    id: newId<UserId>(),
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

export type RegisterResult = { user: ReturnType<typeof createUser> } | { error: 'taken' | 'closed' }

/**
 * Creates an account in one step: the username check, the "first account is the
 * admin" decision and the insert cannot interleave with another registration
 * (the password is hashed before this runs, so nothing here awaits).
 */
export function registerUser(db: Db, u: NewUser, allowRegistration: boolean): RegisterResult {
  return inTransaction(db, (tx): RegisterResult => {
    if (getUserByUsername(tx, u.username)) return { error: 'taken' }
    const isFirst = countUsers(tx) === 0
    if (!isFirst && !allowRegistration) return { error: 'closed' }
    return { user: createUser(tx, { ...u, role: isFirst ? 'admin' : 'user' }) }
  })
}

export function getUserById(db: Db, uid: UserId) {
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
  uid: UserId,
  patch: Partial<{ handle: string; nativeLang: string; targetLang: string; level: string }>,
): void {
  db.update(users)
    .set({ ...patch, updatedAt: now() })
    .where(eq(users.id, uid))
    .run()
}

/**
 * Deletes a member and everything that is theirs, in one transaction. The game
 * and SRS tables cascade from `users`; the older content and history tables have
 * no foreign key, so their rows are removed here. Decks and cards are shared, so
 * they stay (losing only their creator) — until the last member is gone, when
 * nobody is left to study them. Returns false when there was no such member.
 */
export function deleteUser(db: Db, uid: UserId): boolean {
  return inTransaction(db, (tx) => {
    if (!tx.select({ id: users.id }).from(users).where(eq(users.id, uid)).get()) return false
    deleteUserHistory(tx, uid)
    tx.update(decks).set({ userId: null }).where(eq(decks.userId, uid)).run()
    tx.delete(cards).where(eq(cards.privateTo, uid)).run()
    tx.update(cards).set({ userId: null }).where(eq(cards.userId, uid)).run()
    tx.update(audioBlobs).set({ userId: null }).where(eq(audioBlobs.userId, uid)).run()
    tx.delete(users).where(eq(users.id, uid)).run()
    if (countUsers(tx) === 0) deleteAllDecks(tx)
    return true
  })
}

/** The member's chats, reviews, attempts, XP ledger and stats row. */
function deleteUserHistory(db: Db, uid: UserId): void {
  const chats = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, uid)).all()
  for (const c of chats) db.delete(messages).where(eq(messages.sessionId, c.id)).run()
  db.delete(sessions).where(eq(sessions.userId, uid)).run()
  db.delete(reviews).where(eq(reviews.userId, uid)).run()
  db.delete(attempts).where(eq(attempts.userId, uid)).run()
  db.delete(xpEvents).where(eq(xpEvents.userId, uid)).run()
  db.delete(stats).where(eq(stats.userId, uid)).run()
}
