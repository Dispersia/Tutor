/** Admin: manage accounts, keeping everyone's data separate (docs/DESIGN.md §12.5). */

import { toUserId } from '../../ids'
import type { Context } from 'hono'
import { deleteUser, deleteUserAuthSessions, listUsers } from '../../db/repo'
import type { App, AppEnv } from '../../context'
import { currentUser } from './session'
import { fail } from '../errors'

export function registerAuthAdmin(app: App) {
  app.get('/api/users', (c) => listUsersHandler(c))
  app.delete('/api/users/:id', (c) => deleteUserHandler(c))
}

function listUsersHandler(c: Context<AppEnv>) {
  const user = currentUser(c)
  if (!user) return fail(c, 401, 'unauthorized')
  if (user.role !== 'admin') return fail(c, 403, 'forbidden')
  return c.json({ users: listUsers(c.get('deps').db) })
}

function deleteUserHandler(c: Context<AppEnv>) {
  const user = currentUser(c)
  if (!user) return fail(c, 401, 'unauthorized')
  if (user.role !== 'admin') return fail(c, 403, 'forbidden')
  const target = toUserId(String(c.req.param('id')))
  if (target === user.id) return fail(c, 400, 'cannot delete yourself')
  deleteUserAuthSessions(c.get('deps').db, target)
  if (!deleteUser(c.get('deps').db, target)) return fail(c, 404, 'not found')
  return c.json({ ok: true })
}
