/** Account endpoints: register, log in, log out and the profile (docs/DESIGN.md §12.5). */

import type { Context } from 'hono'
import {
  createUser,
  getUserById,
  getUserByUsername,
  publicUser,
  updateUser,
  countUsers,
} from '../../db/repo'
import { hashPassword, verifyPassword } from '../../auth'
import type { App, AppEnv } from '../../context'
import { jsonBody, str } from '../body'
import { currentUser, endSession, startSession } from './session'

interface RegisterBody {
  username?: string
  password?: string
  handle?: string
  nativeLang?: string
  targetLang?: string
  level?: string
}

/** Reads a registration request. */
function readRegister(body: Record<string, unknown>): RegisterBody {
  return {
    username: str(body, 'username'),
    password: str(body, 'password'),
    handle: str(body, 'handle'),
    nativeLang: str(body, 'nativeLang'),
    targetLang: str(body, 'targetLang'),
    level: str(body, 'level'),
  }
}

interface GuardError {
  status: 400 | 403 | 409
  message: string
}

export function registerAccounts(app: App) {
  app.post('/api/auth/register', (c) => registerHandler(c))
  app.post('/api/auth/login', (c) => loginHandler(c))
  app.post('/api/auth/logout', (c) => {
    endSession(c)
    return c.json({ ok: true })
  })
  app.get('/api/auth/me', (c) => c.json({ user: meView(c) }))
  app.put('/api/auth/me', (c) => updateMe(c))
}

async function registerHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const body = readRegister(await jsonBody(c))
  const username = body.username?.trim()
  const password = body.password ?? ''
  const invalid = validateRegister(username, password)
  if (invalid) return c.json({ error: invalid.message }, invalid.status)
  if (getUserByUsername(deps.db, username!)) return c.json({ error: 'username already taken' }, 409)
  const isFirst = countUsers(deps.db) === 0
  if (!isFirst && !deps.allowRegistration) {
    return c.json({ error: 'registration is disabled on this server' }, 403)
  }
  const user = await makeUser(deps.db, body, username!, password, isFirst)
  startSession(c, user.id)
  return c.json({ user: publicUser(user) }, 201)
}

function validateRegister(username: string | undefined, password: string): GuardError | undefined {
  if (!username || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
    return { status: 400, message: 'username must be 2-32 chars: letters, digits, . _ -' }
  }
  if (password.length < 8) {
    return { status: 400, message: 'password must be at least 8 characters' }
  }
  return undefined
}

async function makeUser(
  db: Parameters<typeof createUser>[0],
  body: RegisterBody,
  username: string,
  password: string,
  isFirst: boolean,
) {
  return createUser(db, {
    username,
    passwordHash: await hashPassword(password),
    handle: body.handle?.trim() || username,
    role: isFirst ? 'admin' : 'user',
    nativeLang: body.nativeLang,
    targetLang: body.targetLang,
    level: body.level,
  })
}

async function loginHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const body = await jsonBody(c)
  const username = str(body, 'username')?.trim() ?? ''
  const user = username ? getUserByUsername(deps.db, username) : undefined
  if (
    !user?.passwordHash ||
    !(await verifyPassword(str(body, 'password') ?? '', user.passwordHash))
  ) {
    return c.json({ error: 'invalid username or password' }, 401)
  }
  startSession(c, user.id)
  return c.json({ user: publicUser(user) })
}

function meView(c: Context<AppEnv>) {
  const user = currentUser(c)
  return user ? publicUser(user) : null
}

async function updateMe(c: Context<AppEnv>) {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const body = await jsonBody(c)
  const patch = profilePatch(body)
  if (Object.keys(patch).length) updateUser(c.get('deps').db, user.id, patch)
  return c.json({ user: publicUser(getUserById(c.get('deps').db, user.id)!) })
}

function profilePatch(body: Record<string, unknown>): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const k of ['handle', 'nativeLang', 'targetLang', 'level']) {
    const v = str(body, k)
    if (v) patch[k] = v
  }
  return patch
}
