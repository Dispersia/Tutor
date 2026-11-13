import type { Card, CardType } from '@tutor/core'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Role } from '../env'
import type { Db } from './client'
import {
  authSessions,
  cards,
  decks,
  encounters,
  equipment,
  inventory,
  lessonProgress,
  messages,
  reviews,
  sessions,
  settings,
  skillProgress,
  srs,
  stats,
  talents,
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

// --- skills + materials bank (Phase 8) ---------------------------------------

export function getSkillXp(db: Db, userId: string, skillId: string): number {
  const row = db
    .select()
    .from(skillProgress)
    .where(and(eq(skillProgress.userId, userId), eq(skillProgress.skillId, skillId)))
    .get()
  return row?.xp ?? 0
}

export function listSkillProgress(db: Db, userId: string) {
  return db.select().from(skillProgress).where(eq(skillProgress.userId, userId)).all()
}

export function setSkillXp(
  db: Db,
  userId: string,
  skillId: string,
  xp: number,
  level: number,
): void {
  db.insert(skillProgress)
    .values({ userId, skillId, xp, level, updatedAt: now() })
    .onConflictDoUpdate({
      target: [skillProgress.userId, skillProgress.skillId],
      set: { xp, level, updatedAt: now() },
    })
    .run()
}

export function getItemCount(db: Db, userId: string, itemId: string): number {
  const row = db
    .select()
    .from(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)))
    .get()
  return row?.count ?? 0
}

export function listInventory(db: Db, userId: string) {
  return db.select().from(inventory).where(eq(inventory.userId, userId)).all()
}

/** Adds (or removes, with a negative delta) materials; never goes below zero. */
export function addItems(db: Db, userId: string, itemId: string, delta: number): void {
  db.insert(inventory)
    .values({ userId, itemId, count: Math.max(0, delta), updatedAt: now() })
    .onConflictDoUpdate({
      target: [inventory.userId, inventory.itemId],
      set: { count: sql`max(0, ${inventory.count} + ${delta})`, updatedAt: now() },
    })
    .run()
}

// --- talents + equipment (Phase 8) -------------------------------------------

export function listTalents(db: Db, userId: string) {
  return db.select().from(talents).where(eq(talents.userId, userId)).all()
}

export function hasTalent(db: Db, userId: string, talentId: string): boolean {
  const row = db
    .select()
    .from(talents)
    .where(and(eq(talents.userId, userId), eq(talents.talentId, talentId)))
    .get()
  return Boolean(row)
}

export function addTalent(
  db: Db,
  userId: string,
  t: { talentId: string; skillId: string; tier: string; milestone: number },
): void {
  db.insert(talents)
    .values({
      userId,
      talentId: t.talentId,
      skillId: t.skillId,
      tier: t.tier,
      milestone: t.milestone,
      grantedAt: now(),
    })
    .onConflictDoNothing()
    .run()
}

export function removeTalent(db: Db, userId: string, talentId: string): void {
  db.delete(talents)
    .where(and(eq(talents.userId, userId), eq(talents.talentId, talentId)))
    .run()
}

/** Swaps an owned talent for a different one (respec at the same milestone). */
export function replaceTalent(
  db: Db,
  userId: string,
  oldTalentId: string,
  t: { talentId: string; skillId: string; tier: string; milestone: number },
): void {
  db.transaction((tx) => {
    tx.delete(talents)
      .where(and(eq(talents.userId, userId), eq(talents.talentId, oldTalentId)))
      .run()
    tx.insert(talents)
      .values({
        userId,
        talentId: t.talentId,
        skillId: t.skillId,
        tier: t.tier,
        milestone: t.milestone,
        grantedAt: now(),
      })
      .run()
  })
}

export function listEquipment(db: Db, userId: string) {
  return db.select().from(equipment).where(eq(equipment.userId, userId)).all()
}

export function setEquipment(db: Db, userId: string, slot: string, itemId: string | null): void {
  if (itemId === null) {
    db.delete(equipment)
      .where(and(eq(equipment.userId, userId), eq(equipment.slot, slot)))
      .run()
    return
  }
  db.insert(equipment)
    .values({ userId, slot, itemId, updatedAt: now() })
    .onConflictDoUpdate({
      target: [equipment.userId, equipment.slot],
      set: { itemId, updatedAt: now() },
    })
    .run()
}

/** exerciseId -> most recent use timestamp, for "the next drill" rotation. */
export function lastExerciseUse(db: Db, userId: string): Map<string, number> {
  const rows = db
    .select({ exerciseId: reviews.exerciseId, last: sql<number>`max(${reviews.createdAt})` })
    .from(reviews)
    .where(eq(reviews.userId, userId))
    .groupBy(reviews.exerciseId)
    .all()
  return new Map(
    rows.filter((r) => r.exerciseId).map((r) => [r.exerciseId as string, Number(r.last)]),
  )
}

// --- combat encounters (Phase 8) ---------------------------------------------

export function getEncounter(db: Db, userId: string) {
  return db.select().from(encounters).where(eq(encounters.userId, userId)).get()
}

export function upsertEncounter(
  db: Db,
  userId: string,
  patch: {
    monsterId: string
    monsterHp: number
    playerHp: number
    playerMaxHp?: number
    powerBonus?: number
    potionId?: string | null
    foodEaten?: number
    totalDamage?: number
    xpEarned?: number
  },
): void {
  const extras = {
    ...(patch.playerMaxHp !== undefined ? { playerMaxHp: patch.playerMaxHp } : {}),
    ...(patch.powerBonus !== undefined ? { powerBonus: patch.powerBonus } : {}),
    ...(patch.potionId !== undefined ? { potionId: patch.potionId } : {}),
    ...(patch.foodEaten !== undefined ? { foodEaten: patch.foodEaten } : {}),
    ...(patch.totalDamage !== undefined ? { totalDamage: patch.totalDamage } : {}),
    ...(patch.xpEarned !== undefined ? { xpEarned: patch.xpEarned } : {}),
  }
  db.insert(encounters)
    .values({
      userId,
      monsterId: patch.monsterId,
      monsterHp: patch.monsterHp,
      playerHp: patch.playerHp,
      playerMaxHp: patch.playerMaxHp ?? 0,
      powerBonus: patch.powerBonus ?? 0,
      potionId: patch.potionId ?? null,
      foodEaten: patch.foodEaten ?? 0,
      totalDamage: patch.totalDamage ?? 0,
      xpEarned: patch.xpEarned ?? 0,
      createdAt: now(),
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: encounters.userId,
      set: {
        monsterId: patch.monsterId,
        monsterHp: patch.monsterHp,
        playerHp: patch.playerHp,
        ...extras,
        updatedAt: now(),
      },
    })
    .run()
}

export function clearEncounter(db: Db, userId: string): void {
  db.delete(encounters).where(eq(encounters.userId, userId)).run()
}

// --- spaced repetition + curriculum (Phase 9) --------------------------------

export function getSrs(db: Db, userId: string, cardId: string) {
  return db
    .select()
    .from(srs)
    .where(and(eq(srs.userId, userId), eq(srs.cardId, cardId)))
    .get()
}

export function listSrs(db: Db, userId: string) {
  return db.select().from(srs).where(eq(srs.userId, userId)).all()
}

export function upsertSrs(
  db: Db,
  userId: string,
  cardId: string,
  s: {
    state: string
    step: number
    stability: number
    difficulty: number
    reps: number
    lapses: number
    intervalDays: number
    dueAt: number
    lastRating: number | null
    lastReviewAt: number
  },
): void {
  db.insert(srs)
    .values({ userId, cardId, ...s })
    .onConflictDoUpdate({ target: [srs.userId, srs.cardId], set: { ...s } })
    .run()
}

export function listLessonProgress(db: Db, userId: string) {
  return db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId)).all()
}

export function completeLesson(db: Db, userId: string, lessonId: string): void {
  db.insert(lessonProgress)
    .values({ userId, lessonId, completedAt: now() })
    .onConflictDoNothing()
    .run()
}
