import type { UserId } from '../../ids'
import { eq, sql } from 'drizzle-orm'
import type { Db } from '../client'
import {
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
import { deleteAllDecks, deleteDeck } from './decks'
import { inTransaction, newId, now } from './helpers'

export interface NewUser {
  username: string
  passwordHash?: string
  handle?: string
  role?: 'admin' | 'user'
  nativeLang?: string
  level?: string
}

export interface PublicUser {
  id: UserId
  username: string | null
  handle: string
  role: string
  nativeLang: string
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
    level: u.level ?? null,
    settingsJson: '{}',
    createdAt: now(),
    updatedAt: now(),
  }
  db.insert(users).values(row).run()
  return row
}

export type RegisterResult = { user: ReturnType<typeof createUser> } | { error: 'taken' | 'closed' }

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
  patch: Partial<{ handle: string; nativeLang: string; level: string }>,
): void {
  db.update(users)
    .set({ ...patch, updatedAt: now() })
    .where(eq(users.id, uid))
    .run()
}

export function deleteUser(db: Db, uid: UserId): boolean {
  return inTransaction(db, (tx) => {
    if (!tx.select({ id: users.id }).from(users).where(eq(users.id, uid)).get()) return false
    deleteUserHistory(tx, uid)
    for (const d of tx.select({ id: decks.id }).from(decks).where(eq(decks.userId, uid)).all()) {
      deleteDeck(tx, d.id)
    }
    tx.delete(cards).where(eq(cards.privateTo, uid)).run()
    tx.update(audioBlobs).set({ userId: null }).where(eq(audioBlobs.userId, uid)).run()
    tx.delete(users).where(eq(users.id, uid)).run()
    if (countUsers(tx) === 0) deleteAllDecks(tx)
    return true
  })
}

function deleteUserHistory(db: Db, uid: UserId): void {
  const chats = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, uid)).all()
  for (const c of chats) db.delete(messages).where(eq(messages.sessionId, c.id)).run()
  db.delete(sessions).where(eq(sessions.userId, uid)).run()
  db.delete(reviews).where(eq(reviews.userId, uid)).run()
  db.delete(xpEvents).where(eq(xpEvents.userId, uid)).run()
  db.delete(stats).where(eq(stats.userId, uid)).run()
}
