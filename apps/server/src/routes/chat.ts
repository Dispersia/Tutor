import { streamSSE } from 'hono/streaming'
import { addMessage, createSession, getRoles, getSession, listMessages } from '../db/repo'
import type { Role } from '../env'
import { systemPrompt } from '../llm/prompts'
import type { ChatMessage, Usage } from '../llm/openrouter'
import type { App } from '../context'

const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }

export function registerChat(app: App) {
  // Streamed chat (SSE). Persists the user + assistant turns; permanent history.
  app.post('/api/chat', async (c) => {
    const deps = c.get('deps')
    if (!deps.or.configured) return c.json({ error: 'OPENROUTER_API_KEY is not set' }, 502)

    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string
      role?: Role
      model?: string
      text?: string
      system?: string
      messages?: ChatMessage[]
    }
    const role = (body.role ?? 'conversation') as Role
    const model = body.model ?? getRoles(deps.db, deps.defaults)[role]

    let sid = body.sessionId ?? ''
    if (!sid || !getSession(deps.db, sid)) sid = createSession(deps.db, { kind: 'chat' }).id

    let msgs: ChatMessage[]
    if (body.messages?.length) {
      msgs = body.messages
    } else {
      const history = listMessages(deps.db, sid).map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.text,
      }))
      msgs = [...systemPrompt(role, body.system), ...history]
      if (body.text?.trim()) msgs.push({ role: 'user', content: body.text })
    }
    if (body.text?.trim()) addMessage(deps.db, { sessionId: sid, role: 'user', text: body.text })

    const session = sid
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'session', data: session })
      let full = ''
      let usage = EMPTY_USAGE
      try {
        for await (const ev of deps.or.streamChat({ model, messages: msgs })) {
          if (ev.type === 'delta') {
            full += ev.text
            await stream.writeSSE({ event: 'delta', data: ev.text })
          } else if (ev.type === 'usage') {
            usage = ev.usage
            await stream.writeSSE({ event: 'usage', data: JSON.stringify(ev.usage) })
          }
        }
        addMessage(deps.db, {
          sessionId: session,
          role: 'assistant',
          text: full,
          model,
          tokensIn: usage.promptTokens,
          tokensOut: usage.completionTokens,
          costUsd: usage.costUsd,
        })
        await stream.writeSSE({ event: 'done', data: 'ok' })
      } catch (err) {
        await stream.writeSSE({ event: 'error', data: (err as Error).message })
      }
    })
  })

  // Structured (JSON-schema) completion — used by graders in Phase 4/5.
  app.post('/api/chat/json', async (c) => {
    const deps = c.get('deps')
    if (!deps.or.configured) return c.json({ error: 'OPENROUTER_API_KEY is not set' }, 502)
    const body = (await c.req.json().catch(() => ({}))) as {
      role?: Role
      model?: string
      messages: ChatMessage[]
      schema: object
      schemaName?: string
    }
    const role = (body.role ?? 'judge') as Role
    const model = body.model ?? getRoles(deps.db, deps.defaults)[role]
    try {
      const { json, usage } = await deps.or.chatJSON({
        model,
        messages: body.messages ?? [],
        schema: body.schema,
        schemaName: body.schemaName,
      })
      return c.json({ result: json, usage, model })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })
}
