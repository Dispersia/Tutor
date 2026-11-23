import { toSessionId, type SessionId } from '../../ids'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Context } from 'hono'
import { addMessage, createSession, getOwnedSession, getRoles, listMessages } from '../../db/repo'
import { ROLES, roleReasoning, type Role } from '../../env'
import { OpenRouter, type ChatMessage, type Usage } from '../../llm/openrouter'
import { systemPrompt } from '../../llm/prompts'
import { needKey } from '../errors'
import { resolveKey, type ResolvedKey } from '../../llm/userkey'
import type { App, AppEnv, Deps } from '../../context'
import type { PublicUser } from '../../db/repo'
import { idField, jsonBody, obj, oneOf, str } from '../body'

const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }

interface ChatBody {
  sessionId?: SessionId
  role?: Role
  model?: string
  text?: string
  system?: string
  messages?: ChatMessage[]
}

function chatMessages(v: unknown): ChatMessage[] | undefined {
  if (!Array.isArray(v)) return undefined
  const msgs = v.filter(isChatMessage)
  return msgs.length ? msgs : undefined
}

function isChatMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== 'object') return false
  const { role, content } = m as { role?: unknown; content?: unknown }
  return typeof role === 'string' && typeof content === 'string'
}

function readChatBody(body: Record<string, unknown>): ChatBody {
  return {
    sessionId: idField(body, 'sessionId', toSessionId),
    role: oneOf(body, 'role', ROLES),
    model: str(body, 'model'),
    text: str(body, 'text'),
    system: str(body, 'system'),
    messages: chatMessages(body.messages),
  }
}

function allowed<T extends { model?: string; messages?: ChatMessage[]; system?: string }>(
  body: T,
  source: ResolvedKey['source'],
): T {
  if (source === 'user') return body
  return { ...body, model: undefined, messages: undefined, system: undefined } as T
}

interface StreamReq {
  c: Context<AppEnv>
  deps: Deps
  or: OpenRouter
  model: string
  role: Role
  sid: SessionId
  msgs: ChatMessage[]
}

interface StreamAcc {
  full: string
  usage: Usage
}

export function registerChat(app: App) {
  app.post('/api/chat', (c) => chatHandler(c))
  app.post('/api/chat/json', (c) => jsonHandler(c))
}

async function chatHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const resolved = await resolveKey(deps, user.id)
  if (!resolved) return needKey(c)
  const body = allowed(readChatBody(await jsonBody(c)), resolved.source)
  const role = body.role ?? 'conversation'
  const model = body.model ?? getRoles(deps.db, user.id, deps.defaults)[role]
  const sid = ensureSession(deps, user, body.sessionId)
  const msgs = messageList(deps, user, sid, role, body)
  if (body.text?.trim()) addMessage(deps.db, { sessionId: sid, role: 'user', text: body.text })
  const or = new OpenRouter(resolved.key, deps.or.baseUrl)
  return streamReply({ c, deps, or, model, role, sid, msgs })
}

function ensureSession(deps: Deps, user: PublicUser, sessionId?: SessionId): SessionId {
  if (sessionId && getOwnedSession(deps.db, sessionId, user.id)) return sessionId
  return createSession(deps.db, user.id, { kind: 'chat', lang: user.targetLang ?? undefined }).id
}

function messageList(
  deps: Deps,
  user: PublicUser,
  sid: SessionId,
  role: Role,
  body: ChatBody,
): ChatMessage[] {
  if (body.messages?.length) return body.messages
  const history = listHistory(deps, sid)
  const msgs = [...systemPrompt(role, user, body.system), ...history]
  if (body.text?.trim()) msgs.push({ role: 'user', content: body.text })
  return msgs
}

function listHistory(deps: Deps, sid: SessionId): ChatMessage[] {
  return listMessages(deps.db, sid).map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.text,
  }))
}

async function streamReply(req: StreamReq) {
  return streamSSE(req.c, async (stream) => {
    const gone = new AbortController()
    stream.onAbort(() => gone.abort())
    await stream.writeSSE({ event: 'session', data: req.sid })
    try {
      const acc = await pipeReply(req, stream, gone.signal)
      if (gone.signal.aborted) return
      saveAssistant(req, acc)
      await stream.writeSSE({ event: 'done', data: 'ok' })
    } catch (err) {
      if (gone.signal.aborted) return
      await stream.writeSSE({ event: 'error', data: (err as Error).message })
    }
  })
}

async function pipeReply(
  req: StreamReq,
  stream: SSEStreamingApi,
  signal: AbortSignal,
): Promise<StreamAcc> {
  const acc: StreamAcc = { full: '', usage: EMPTY_USAGE }
  const events = req.or.streamChat({
    model: req.model,
    messages: req.msgs,
    reasoning: roleReasoning[req.role],
    signal,
  })
  await forwardEvents(stream, events, acc)
  return acc
}

async function forwardEvents(
  stream: SSEStreamingApi,
  events: AsyncIterable<{ type: string; text?: string; usage?: Usage }>,
  acc: StreamAcc,
): Promise<void> {
  for await (const ev of events) {
    if (ev.type === 'delta') {
      acc.full += ev.text ?? ''
      await stream.writeSSE({ event: 'delta', data: ev.text ?? '' })
    } else if (ev.type === 'usage' && ev.usage) {
      acc.usage = ev.usage
      await stream.writeSSE({ event: 'usage', data: JSON.stringify(ev.usage) })
    }
  }
}

function saveAssistant(req: StreamReq, acc: StreamAcc): void {
  addMessage(req.deps.db, {
    sessionId: req.sid,
    role: 'assistant',
    text: acc.full,
    model: req.model,
    tokensIn: acc.usage.promptTokens,
    tokensOut: acc.usage.completionTokens,
    costUsd: acc.usage.costUsd,
  })
}

interface JsonBody {
  role?: Role
  model?: string
  messages: ChatMessage[]
  schema: object
  schemaName?: string
}

function readJsonBody(body: Record<string, unknown>): JsonBody {
  return {
    role: oneOf(body, 'role', ROLES),
    model: str(body, 'model'),
    messages: chatMessages(body.messages) ?? [],
    schema: obj(body, 'schema') ?? {},
    schemaName: str(body, 'schemaName'),
  }
}

const OWN_KEY_ONLY = 'This endpoint needs your own OpenRouter key — add one in Settings.'

async function jsonHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const resolved = await resolveKey(deps, user.id)
  if (!resolved) return needKey(c)
  if (resolved.source !== 'user') return c.json({ error: OWN_KEY_ONLY }, 403)
  const body = readJsonBody(await jsonBody(c))
  const role = body.role ?? 'judge'
  const model = body.model ?? getRoles(deps.db, user.id, deps.defaults)[role]
  const or = new OpenRouter(resolved.key, deps.or.baseUrl)
  try {
    const { json, usage } = await runJson(or, model, role, body)
    return c.json({ result: json, usage, model })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

async function runJson(or: OpenRouter, model: string, role: Role, body: JsonBody) {
  return or.chatJSON({
    model,
    messages: body.messages ?? [],
    schema: body.schema,
    schemaName: body.schemaName,
    reasoning: roleReasoning[role],
  })
}
