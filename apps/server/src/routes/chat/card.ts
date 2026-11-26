import { toDeckId, toSessionId } from '../../ids'
import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { getOwnedSession } from '../../db/repo'
import { CHAT_CARD_FAILED, saveChatCard, suggestChatCard } from '../../deck/chatCard'
import type { ChatCardInput } from '../../deck/chatCard'
import { sanitizePlannedCard, type PlannedCard } from '../../deck/plan'
import { idField, jsonBody, obj, str } from '../body'
import { fail } from '../errors'

export function registerChatCard(app: App) {
  app.post('/api/chat/card/suggest', (c) => suggestHandler(c))
  app.post('/api/chat/card', (c) => saveHandler(c))
}

async function suggestHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const sid = idField(body, 'sessionId', toSessionId)
  if (!sid || !getOwnedSession(deps.db, sid, user.id)) return fail(c, 400, 'unknown session')
  const suggestion = await suggestChatCard(deps, user, sid)
  return c.json({ suggestion: suggestion ?? null })
}

async function saveHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const suggestion = readSuggestion(await jsonBody(c))
  if (!suggestion) return fail(c, 400, 'a card is required')
  const saved = await saveChatCard(deps, user, suggestion)
  if (!saved) return fail(c, 422, CHAT_CARD_FAILED)
  return c.json({ card: saved }, 201)
}

function readSuggestion(body: Record<string, unknown>): ChatCardInput | undefined {
  const deckId = idField(body, 'deckId', toDeckId)
  const targetLang = str(body, 'targetLang')
  const card = readCard(obj(body, 'card'))
  if (!deckId || !targetLang || !card) return undefined
  return { deckId, targetLang, card }
}

function readCard(raw: Record<string, unknown> | undefined): PlannedCard | undefined {
  if (!raw || typeof raw.front !== 'string' || typeof raw.back !== 'string') return undefined
  const template = raw.template
  return sanitizePlannedCard({
    template: template === 'sentence' || template === 'grammar' ? template : 'vocab',
    front: raw.front,
    back: raw.back,
    reading: typeof raw.reading === 'string' ? raw.reading : undefined,
    payload: isRecord(raw.payload) ? raw.payload : undefined,
    metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
