import { desc, eq } from 'drizzle-orm'
import type { Role } from '../env'
import type { Db } from './client'
import { messages, sessions, settings } from './schema'

const now = () => Date.now()
const id = () => crypto.randomUUID()

// --- settings kv -------------------------------------------------------------

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function allSettings(db: Db): Record<string, string> {
  return Object.fromEntries(
    db
      .select()
      .from(settings)
      .all()
      .map((r) => [r.key, r.value]),
  )
}

// --- roles (user-selectable OpenRouter models) -------------------------------

export function getRoles(db: Db, defaults: Record<Role, string>): Record<Role, string> {
  const raw = getSetting(db, 'roles')
  if (!raw) return { ...defaults }
  try {
    return { ...defaults, ...(JSON.parse(raw) as Record<Role, string>) }
  } catch {
    return { ...defaults }
  }
}

export function setRole(
  db: Db,
  defaults: Record<Role, string>,
  role: Role,
  model: string,
): Record<Role, string> {
  const next = { ...getRoles(db, defaults), [role]: model }
  setSetting(db, 'roles', JSON.stringify(next))
  return next
}

// --- sessions + messages (append-only history) -------------------------------

export interface NewSession {
  id?: string
  userId?: string
  deckId?: string
  kind?: 'chat' | 'voice' | 'mixed'
  lang?: string
  title?: string
}

export function createSession(db: Db, s: NewSession = {}) {
  const row = {
    id: s.id ?? id(),
    userId: s.userId ?? null,
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

export function getSession(db: Db, sid: string) {
  return db.select().from(sessions).where(eq(sessions.id, sid)).get()
}

export function listSessions(db: Db, limit = 50) {
  return db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit).all()
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
