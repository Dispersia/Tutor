import { expect, test } from 'bun:test'
import type { UserId } from '../../ids'
import { createApp } from '../../app'
import type { Deps } from '../../context'
import { openDb } from '../../db/client'
import { addMessage, createDeck, createSession, listCards } from '../../db/repo'
import type { Role } from '../../env'
import { EventBus } from '../../events'
import { OpenRouter } from '../../llm/openrouter'
import { SpeechSupervisor } from '../../speech/supervisor'
import type { ChatPlanner } from '../../deck/plan'

const defaults: Record<Role, string> = {
  conversation: 'qwen/c',
  judge: 'qwen/j',
  generator: 'qwen/g',
  translator: 'qwen/t',
}

function depsWith(db: Deps['db'], chatPlanner: ChatPlanner): Deps {
  return {
    db,
    or: new OpenRouter('k', 'http://127.0.0.1:1'),
    supervisor: new SpeechSupervisor({
      url: 'http://127.0.0.1:1',
      port: 1,
      pythonDir: '.',
      modelsDir: '.',
      idleTimeoutMs: 600_000,
      autostart: false,
    }),
    defaults,
    serverKey: 'server-key',
    secret: undefined,
    allowRegistration: true,
    sessionTtlMs: 86_400_000,
    events: new EventBus(),
    chatPlanner,
  }
}

async function setup(langs: string[]) {
  const { db, sqlite } = openDb(':memory:')
  const deps = depsWith(db, async () => ({
    targetLang: 'ko',
    cards: [{ template: 'vocab', front: 'friend', back: '친구' }],
  }))
  const app = createApp(deps, { staticDir: '/definitely/not/here', log: false })
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password123' }),
  })
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const userId = ((await res.json()) as { user: { id: UserId } }).user.id
  const decks = langs.map((targetLang) =>
    createDeck(db, userId, { name: `${targetLang} deck`, sourceLang: 'en', targetLang }),
  )
  const session = createSession(db, userId, { kind: 'chat', lang: langs[0] })
  addMessage(db, { sessionId: session.id, role: 'user', text: 'How do I say friend?' })
  addMessage(db, { sessionId: session.id, role: 'assistant', text: '친구.' })
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })
  return { db, sqlite, userId, decks, app, post, sessionId: session.id }
}

test('the suggest endpoint returns a card for a language with a deck', async () => {
  const { sqlite, post, sessionId, decks } = await setup(['ko'])
  const res = await post('/api/chat/card/suggest', { sessionId })
  const { suggestion } = (await res.json()) as {
    suggestion: { deckId: string; deckName: string; card: { back: string } } | null
  }
  expect(suggestion?.deckId).toBe(decks[0]!.id)
  expect(suggestion?.card.back).toBe('친구')
  sqlite.close()
})

test('the suggest endpoint offers nothing for a language with no deck', async () => {
  const { sqlite, post, sessionId } = await setup([])
  const res = await post('/api/chat/card/suggest', { sessionId })
  const { suggestion } = (await res.json()) as { suggestion: unknown }
  expect(suggestion).toBeNull()
  sqlite.close()
})

test('confirming stores the card and rejects a mismatched language', async () => {
  const { db, sqlite, userId, decks, post, sessionId } = await setup(['ko'])
  const suggest = await post('/api/chat/card/suggest', { sessionId })
  const { suggestion } = (await suggest.json()) as {
    suggestion: { deckId: string; targetLang: string; card: unknown }
  }
  const good = await post('/api/chat/card', suggestion)
  expect(good.status).toBe(201)
  expect(listCards(db, userId, decks[0]!.id).map((c) => c.back)).toContain('친구')

  const bad = await post('/api/chat/card', { ...suggestion, targetLang: 'ru' })
  expect(bad.status).toBe(422)
  sqlite.close()
})

test('a suggestion is refused for a session the member does not own', async () => {
  const { sqlite, post } = await setup(['ko'])
  const res = await post('/api/chat/card/suggest', { sessionId: 'ses_nope' })
  expect(res.status).toBe(400)
  sqlite.close()
})
