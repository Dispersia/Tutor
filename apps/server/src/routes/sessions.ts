import { createSession, getSession, listMessages, listSessions, type NewSession } from '../db/repo'
import type { App } from '../context'

export function registerSessions(app: App) {
  app.get('/api/sessions', (c) => c.json({ sessions: listSessions(c.get('deps').db) }))

  app.post('/api/sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as NewSession
    return c.json(createSession(c.get('deps').db, body), 201)
  })

  app.get('/api/sessions/:id', (c) => {
    const db = c.get('deps').db
    const session = getSession(db, c.req.param('id'))
    if (!session) return c.json({ error: 'not found' }, 404)
    return c.json({ session, messages: listMessages(db, session.id) })
  })
}
