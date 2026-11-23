/**
 * Chat: streamed conversation (SSE) and a JSON-schema completion
 * (docs/DESIGN.md §10).
 */

import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Context } from 'hono'
import { addMessage, createSession, getOwnedSession, getRoles, listMessages } from '../../db/repo'
import { roleReasoning, type Role } from '../../env'
import { OpenRouter, type ChatMessage, type Usage } from '../../llm/openrouter'
import { CONVERSATION_LANGUAGE_RULE, NATIVE_FEEDBACK_RULE, systemPrompt } from '../../llm/prompts'
import { resolveUserKey } from '../../llm/userkey'
import type { App, AppEnv, Deps } from '../../context'
import type { PublicUser } from '../../db/repo'

const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }

interface ChatBody {
  sessionId?: string
  role?: Role
  model?: string
  text?: string
  system?: string
  messages?: ChatMessage[]
}

/** Everything one streamed reply needs, resolved before the stream opens. */
interface StreamReq {
  c: Context<AppEnv>
  deps: Deps
  or: OpenRouter
  model: string
  role: Role
  sid: string
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

/** Streamed chat (SSE). Scoped to the signed-in user; persists both turns. */
async function chatHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  const body = (await c.req.json().catch(() => ({}))) as ChatBody
  const role = (body.role ?? 'conversation') as Role
  const model = body.model ?? getRoles(deps.db, user.id, deps.defaults)[role]
  const sid = ensureSession(deps, user, body.sessionId)
  const msgs = messageList(deps, user, sid, role, body)
  if (body.text?.trim()) addMessage(deps.db, { sessionId: sid, role: 'user', text: body.text })
  return streamReply({ c, deps, or: new OpenRouter(key, deps.or.baseUrl), model, role, sid, msgs })
}

function ensureSession(deps: Deps, user: PublicUser, sessionId?: string): string {
  if (sessionId && getOwnedSession(deps.db, sessionId, user.id)) return sessionId
  return createSession(deps.db, user.id, { kind: 'chat', lang: user.targetLang ?? undefined }).id
}

/**
 * The messages to send. Keep the dialogue in the target language, but any
 * correction or grammar note the learner has to read in their native language.
 */
function messageList(
  deps: Deps,
  user: PublicUser,
  sid: string,
  role: Role,
  body: ChatBody,
): ChatMessage[] {
  if (body.messages?.length) return body.messages
  const rule =
    role === 'conversation'
      ? CONVERSATION_LANGUAGE_RULE(user.nativeLang, user.targetLang)
      : NATIVE_FEEDBACK_RULE(user.nativeLang, user.targetLang)
  const extra = [body.system, rule].filter(Boolean).join('\n')
  const history = listHistory(deps, sid)
  const msgs = [...systemPrompt(role, extra), ...history]
  if (body.text?.trim()) msgs.push({ role: 'user', content: body.text })
  return msgs
}

function listHistory(deps: Deps, sid: string): ChatMessage[] {
  return listMessages(deps.db, sid).map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.text,
  }))
}

async function streamReply(req: StreamReq) {
  return streamSSE(req.c, async (stream) => {
    await stream.writeSSE({ event: 'session', data: req.sid })
    const acc: StreamAcc = { full: '', usage: EMPTY_USAGE }
    try {
      const events = req.or.streamChat({
        model: req.model,
        messages: req.msgs,
        reasoning: roleReasoning[req.role],
      })
      await forwardEvents(stream, events, acc)
      saveAssistant(req, acc)
      await stream.writeSSE({ event: 'done', data: 'ok' })
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: (err as Error).message })
    }
  })
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

/** Structured (JSON-schema) completion — used by the graders. */
async function jsonHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  const body = (await c.req.json().catch(() => ({}))) as JsonBody
  const role = (body.role ?? 'judge') as Role
  const model = body.model ?? getRoles(deps.db, user.id, deps.defaults)[role]
  try {
    const { json, usage } = await runJson(new OpenRouter(key, deps.or.baseUrl), model, role, body)
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
