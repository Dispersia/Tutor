/** Login (bearer) sessions. */

import { eq } from 'drizzle-orm'
import type { Db } from '../client'
import { authSessions } from '../schema'
import { now } from './helpers'
import { getUserById } from './users'

export function insertAuthSession(
  db: Db,
  tokenId: string,
  userId: string,
  ttlMs: number,
  userAgent?: string,
): number {
  const expiresAt = now() + ttlMs
  db.insert(authSessions)
    .values({ id: tokenId, userId, createdAt: now(), expiresAt, userAgent: userAgent ?? null })
    .run()
  return expiresAt
}

export function getAuthSessionUser(db: Db, tokenId: string) {
  const row = db.select().from(authSessions).where(eq(authSessions.id, tokenId)).get()
  if (!row) return undefined
  if (row.expiresAt < now()) {
    db.delete(authSessions).where(eq(authSessions.id, tokenId)).run()
    return undefined
  }
  return getUserById(db, row.userId)
}

export function deleteAuthSession(db: Db, tokenId: string): void {
  db.delete(authSessions).where(eq(authSessions.id, tokenId)).run()
}

export function deleteUserAuthSessions(db: Db, userId: string): void {
  db.delete(authSessions).where(eq(authSessions.userId, userId)).run()
}
