import { and, desc, eq } from 'drizzle-orm'
import type { Role } from '../env'
import type { Db } from './client'
import { authSessions, messages, sessions, settings, userSettings, users } from './schema'

const now = () => Date.now()
const id = () => crypto.randomUUID()

// --- server-global settings --------------------------------------------------

export function getSetting(db: Db, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

// --- users -------------------------------------------------------------------

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

export function countUsers(db: Db): number {
  return db.select().from(users).all().length
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

// --- login sessions ----------------------------------------------------------

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

// --- per-user settings -------------------------------------------------------

export function getUserSetting(db: Db, userId: string, key: string): string | undefined {
  return db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
    .get()?.value
}

export function setUserSetting(db: Db, userId: string, key: string, value: string): void {
  db.insert(userSettings)
    .values({ userId, key, value })
    .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { value } })
    .run()
}

export function allUserSettings(db: Db, userId: string): Record<string, string> {
  return Object.fromEntries(
    db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .all()
      .map((r) => [r.key, r.value]),
  )
}

// --- per-user roles (OpenRouter model selection) -----------------------------

export function getRoles(
  db: Db,
  userId: string,
  defaults: Record<Role, string>,
): Record<Role, string> {
  const raw = getUserSetting(db, userId, 'roles')
  if (!raw) return { ...defaults }
  try {
    return { ...defaults, ...(JSON.parse(raw) as Record<Role, string>) }
  } catch {
    return { ...defaults }
  }
}

export function setRole(
  db: Db,
  userId: string,
  defaults: Record<Role, string>,
  role: Role,
  model: string,
): Record<Role, string> {
  const next = { ...getRoles(db, userId, defaults), [role]: model }
  setUserSetting(db, userId, 'roles', JSON.stringify(next))
  return next
}

// --- sessions + messages (per-user, append-only) -----------------------------

export interface NewSession {
  id?: string
  deckId?: string
  kind?: 'chat' | 'voice' | 'mixed'
  lang?: string
  title?: string
}

export function createSession(db: Db, userId: string, s: NewSession = {}) {
  const row = {
    id: s.id ?? id(),
    userId,
    deckId: s.deckId ?? null,
    kind: s.kind ?? 'chat',
    lang: s.lang ?? null,
    title: s.title ?? null,
    startedAt: now(),
    endedAt: null,
  }
  db.insert(sessions).values(row).run()
  return row
}

/** Returns the session only if it belongs to this user. */
export function getOwnedSession(db: Db, sid: string, userId: string) {
  const row = db.select().from(sessions).where(eq(sessions.id, sid)).get()
  if (!row || row.userId !== userId) return undefined
  return row
}

export function listSessions(db: Db, userId: string, limit = 100) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .all()
}

export interface NewMessage {
  sessionId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  text: string
  model?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  audioRef?: string
}

export function addMessage(db: Db, m: NewMessage) {
  const row = {
    id: id(),
    sessionId: m.sessionId,
    role: m.role,
    text: m.text,
    audioRef: m.audioRef ?? null,
    model: m.model ?? null,
    tokensIn: m.tokensIn ?? 0,
    tokensOut: m.tokensOut ?? 0,
    costUsd: m.costUsd ?? 0,
    createdAt: now(),
  }
  db.insert(messages).values(row).run()
  return row
}

export function listMessages(db: Db, sessionId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
}
