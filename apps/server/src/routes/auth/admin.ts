/** Admin: manage accounts, keeping everyone's data separate (docs/DESIGN.md §12.5). */

import type { Context } from 'hono'
import { deleteUser, deleteUserAuthSessions, listUsers } from '../../db/repo'
import type { App, AppEnv } from '../../context'
import { currentUser } from './session'

export function registerAuthAdmin(app: App) {
  app.get('/api/users', (c) => listUsersHandler(c))
  app.delete('/api/users/:id', (c) => deleteUserHandler(c))
}

function listUsersHandler(c: Context<AppEnv>) {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  return c.json({ users: listUsers(c.get('deps').db) })
}

function deleteUserHandler(c: Context<AppEnv>) {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  const target = String(c.req.param('id'))
  if (target === user.id) return c.json({ error: 'cannot delete yourself' }, 400)
  deleteUserAuthSessions(c.get('deps').db, target)
  deleteUser(c.get('deps').db, target)
  return c.json({ ok: true })
}
