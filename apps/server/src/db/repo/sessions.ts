/** Per-user chat sessions and their messages (append-only). */

import type { UserId, DeckId, SessionId } from '../../ids'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { messages, sessions } from '../schema'
import { id, newId, now } from './helpers'

export interface NewSession {
  id?: SessionId
  deckId?: DeckId
  kind?: 'chat' | 'voice' | 'mixed'
  lang?: string
  title?: string
}

export function createSession(db: Db, userId: UserId, s: NewSession = {}) {
  const row = {
    id: s.id ?? newId<SessionId>(),
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
export function getOwnedSession(db: Db, sid: SessionId, userId: UserId) {
  const row = db.select().from(sessions).where(eq(sessions.id, sid)).get()
  if (!row || row.userId !== userId) return undefined
  return row
}

export function listSessions(db: Db, userId: UserId, limit = 100) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .all()
}

export interface NewMessage {
  sessionId: SessionId
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

export function listMessages(db: Db, sessionId: SessionId) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
}
