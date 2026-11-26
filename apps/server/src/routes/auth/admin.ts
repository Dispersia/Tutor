import { toUserId } from '../../ids'
import type { Context } from 'hono'
import { deleteUser, deleteUserAuthSessions, listUsers } from '../../db/repo'
import type { App, AppEnv } from '../../context'
import { adminOnly } from '../guards'
import { fail } from '../errors'

export function registerAuthAdmin(app: App) {
  app.get('/api/users', (c) => listUsersHandler(c))
  app.delete('/api/users/:id', (c) => deleteUserHandler(c))
}

function listUsersHandler(c: Context<AppEnv>) {
  const denied = adminOnly(c)
  if (denied) return denied
  return c.json({ users: listUsers(c.get('deps').db) })
}

function deleteUserHandler(c: Context<AppEnv>) {
  const denied = adminOnly(c)
  if (denied) return denied
  const user = c.get('user')!
  const target = toUserId(String(c.req.param('id')))
  if (target === user.id) return fail(c, 400, 'cannot delete yourself')
  deleteUserAuthSessions(c.get('deps').db, target)
  if (!deleteUser(c.get('deps').db, target)) return fail(c, 404, 'not found')
  return c.json({ ok: true })
}
