import {
  createSession,
  getOwnedSession,
  listMessages,
  listSessions,
  type NewSession,
} from '../db/repo'
import type { App } from '../context'
import { jsonBody, oneOf, str } from './body'

const SESSION_KINDS = ['chat', 'voice', 'mixed'] as const

/** Reads the metadata a new session can carry. */
function readNewSession(body: Record<string, unknown>): NewSession {
  return {
    id: str(body, 'id'),
    deckId: str(body, 'deckId'),
    kind: oneOf(body, 'kind', SESSION_KINDS),
    lang: str(body, 'lang'),
    title: str(body, 'title'),
  }
}

export function registerSessions(app: App) {
  // Every query is scoped to the signed-in user — separate history per person.
  app.get('/api/sessions', (c) => {
    const user = c.get('user')!
    return c.json({ sessions: listSessions(c.get('deps').db, user.id) })
  })

  app.post('/api/sessions', async (c) => {
    const user = c.get('user')!
    const body = readNewSession(await jsonBody(c))
    return c.json(createSession(c.get('deps').db, user.id, body), 201)
  })

  app.get('/api/sessions/:id', (c) => {
    const user = c.get('user')!
    const db = c.get('deps').db
    const session = getOwnedSession(db, c.req.param('id'), user.id)
    if (!session) return c.json({ error: 'not found' }, 404)
    return c.json({ session, messages: listMessages(db, session.id) })
  })
}
