import type { Card, CardType } from '@tutor/core'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Role } from '../env'
import type { Db } from './client'
import {
  authSessions,
  cards,
  decks,
  messages,
  reviews,
  sessions,
  settings,
  stats,
  userSettings,
  users,
  xpEvents,
} from './schema'

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

// --- decks + cards (Phase 4) -------------------------------------------------

export interface NewDeck {
  name: string
  sourceLang: string
  targetLang: string
  level?: string
  description?: string
}

export function createDeck(db: Db, userId: string, d: NewDeck) {
  const row = {
    id: id(),
    userId,
    name: d.name,
    sourceLang: d.sourceLang,
    targetLang: d.targetLang,
    level: d.level ?? null,
    description: d.description ?? null,
  }
  db.insert(decks).values(row).run()
  return row
}

export function listDecks(db: Db, userId: string) {
  return db
    .select({
      id: decks.id,
      name: decks.name,
      sourceLang: decks.sourceLang,
      targetLang: decks.targetLang,
      level: decks.level,
      description: decks.description,
      cardCount: sql<number>`count(${cards.id})`,
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .where(eq(decks.userId, userId))
    .groupBy(decks.id)
    .orderBy(asc(decks.name))
    .all()
}

export function getDeck(db: Db, deckId: string, userId: string) {
  const row = db.select().from(decks).where(eq(decks.id, deckId)).get()
  return row && row.userId === userId ? row : undefined
}

export interface NewCard {
  deckId: string
  type?: CardType
  sourceLang: string
  targetLang: string
  front: string
  back: string
  readings?: Record<string, string>
  tags?: string[]
  payload?: Record<string, unknown>
  origin?: 'curated' | 'llm' | 'manual'
}

export function addCard(db: Db, userId: string, c: NewCard) {
  const row = {
    id: id(),
    deckId: c.deckId,
    userId,
    type: c.type ?? 'vocab',
    sourceLang: c.sourceLang,
    targetLang: c.targetLang,
    front: c.front,
    back: c.back,
    readingsJson: JSON.stringify(c.readings ?? {}),
    tagsJson: JSON.stringify(c.tags ?? []),
    payloadJson: JSON.stringify(c.payload ?? {}),
    origin: c.origin ?? 'manual',
    createdAt: now(),
  }
  db.insert(cards).values(row).run()
  return row
}

function toCard(row: typeof cards.$inferSelect): Card {
  const parse = <T>(json: string, fallback: T): T => {
    try {
      return JSON.parse(json) as T
    } catch {
      return fallback
    }
  }
  return {
    id: row.id,
    deckId: row.deckId,
    type: row.type as CardType,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    front: row.front,
    back: row.back,
    readings: parse<Record<string, string>>(row.readingsJson, {}),
    tags: parse<string[]>(row.tagsJson, []),
    payload: parse<Record<string, unknown>>(row.payloadJson, {}),
    origin: row.origin as Card['origin'],
    createdAt: row.createdAt,
  }
}

export function listCards(db: Db, userId: string, deckId?: string): Card[] {
  const rows = deckId
    ? db
        .select()
        .from(cards)
        .where(and(eq(cards.userId, userId), eq(cards.deckId, deckId)))
        .all()
    : db.select().from(cards).where(eq(cards.userId, userId)).all()
  return rows.map(toCard)
}

export function getCard(db: Db, cardId: string, userId: string): Card | undefined {
  const row = db.select().from(cards).where(eq(cards.id, cardId)).get()
  return row && row.userId === userId ? toCard(row) : undefined
}

/** Picks a card, preferring ones the learner has reviewed least. */
export function pickCard(db: Db, userId: string, deckId?: string): Card | undefined {
  const least = sql<number>`(select count(*) from ${reviews} r where r.card_id = ${cards.id})`
  const where = deckId
    ? and(eq(cards.userId, userId), eq(cards.deckId, deckId))
    : eq(cards.userId, userId)
  const row = db
    .select()
    .from(cards)
    .where(where)
    .orderBy(asc(least), sql`random()`)
    .limit(1)
    .get()
  return row ? toCard(row) : undefined
}

/** Wrong answers for multiple-choice: other cards' target text. */
export function otherBacks(
  db: Db,
  userId: string,
  targetLang: string,
  excludeCardId: string,
  limit = 3,
): string[] {
  return db
    .select({ back: cards.back })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.targetLang, targetLang)))
    .orderBy(sql`random()`)
    .limit(limit + 1)
    .all()
    .map((r) => r.back)
    .filter((b) => b !== excludeCardId)
    .slice(0, limit)
}

// --- reviews, XP, stats (Phase 4/6) -----------------------------------------

export function addReview(
  db: Db,
  r: {
    cardId: string
    userId: string
    exerciseId: string
    score: number
    latencyMs?: number
    detail?: Record<string, unknown>
    audioRef?: string
  },
): void {
  db.insert(reviews)
    .values({
      id: id(),
      cardId: r.cardId,
      userId: r.userId,
      exerciseId: r.exerciseId,
      score: r.score,
      latencyMs: r.latencyMs ?? 0,
      detailJson: JSON.stringify(r.detail ?? {}),
      audioRef: r.audioRef ?? null,
      createdAt: now(),
    })
    .run()
}

/** Append-only XP ledger write (the source of truth for totals). */
export function addXpEvent(
  db: Db,
  userId: string,
  amount: number,
  reason: string,
  sourceId?: string,
): void {
  if (amount <= 0) return
  db.insert(xpEvents)
    .values({ id: id(), userId, amount, reason, sourceId: sourceId ?? null, createdAt: now() })
    .run()
}

export function sumXp(db: Db, userId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .get()
  return Number(row?.total ?? 0)
}

/** Every XP event for a user (used to derive days/streak in one timezone). */
export function xpEventsFor(db: Db, userId: string): { createdAt: number; amount: number }[] {
  return db
    .select({ createdAt: xpEvents.createdAt, amount: xpEvents.amount })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .all()
}

export function getStats(db: Db, userId: string) {
  const row = db.select().from(stats).where(eq(stats.userId, userId)).get()
  return (
    row ?? {
      userId,
      xpTotal: 0,
      level: 1,
      streakDays: 0,
      lastActiveDay: null as string | null,
      dailyGoal: 50,
      updatedAt: 0,
    }
  )
}

export function upsertStats(
  db: Db,
  userId: string,
  patch: Partial<{
    xpTotal: number
    level: number
    streakDays: number
    lastActiveDay: string | null
    dailyGoal: number
  }>,
): void {
  db.insert(stats)
    .values({
      userId,
      xpTotal: patch.xpTotal ?? 0,
      level: patch.level ?? 1,
      streakDays: patch.streakDays ?? 0,
      lastActiveDay: patch.lastActiveDay ?? null,
      dailyGoal: patch.dailyGoal ?? 50,
      updatedAt: now(),
    })
    .onConflictDoUpdate({ target: stats.userId, set: { ...patch, updatedAt: now() } })
    .run()
}

export function setDailyGoal(db: Db, userId: string, goal: number): void {
  upsertStats(db, userId, { dailyGoal: Math.max(10, Math.min(1000, Math.round(goal))) })
}
