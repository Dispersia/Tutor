import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { SESSION_COOKIE, hashPassword, newSessionToken, tokenId, verifyPassword } from '../auth'
import type { App, AppEnv } from '../context'
import {
  countUsers,
  createUser,
  deleteAuthSession,
  deleteUser,
  deleteUserAuthSessions,
  getAuthSessionUser,
  getUserById,
  getUserByUsername,
  insertAuthSession,
  listUsers,
  publicUser,
  updateUser,
} from '../db/repo'
import { seedStarterDecks } from '../seed/service'

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:'
}

export function currentUser(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return undefined
  return getAuthSessionUser(deps.db, tokenId(token))
}

function startSession(c: Context<AppEnv>, userId: string): void {
  const deps = c.get('deps')
  const token = newSessionToken()
  insertAuthSession(deps.db, tokenId(token), userId, deps.sessionTtlMs, c.req.header('user-agent'))
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isHttps(c),
    maxAge: Math.floor(deps.sessionTtlMs / 1000),
  })
}

export function registerAuth(app: App) {
  app.post('/api/auth/register', async (c) => {
    const deps = c.get('deps')
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string
      password?: string
      handle?: string
      nativeLang?: string
      targetLang?: string
      level?: string
    }
    const username = body.username?.trim()
    const password = body.password ?? ''
    if (!username || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
      return c.json({ error: 'username must be 2-32 chars: letters, digits, . _ -' }, 400)
    }
    if (password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400)
    if (getUserByUsername(deps.db, username))
      return c.json({ error: 'username already taken' }, 409)

    const isFirst = countUsers(deps.db) === 0
    if (!isFirst && !deps.allowRegistration) {
      return c.json({ error: 'registration is disabled on this server' }, 403)
    }
    const user = createUser(deps.db, {
      username,
      passwordHash: await hashPassword(password),
      handle: body.handle?.trim() || username,
      role: isFirst ? 'admin' : 'user',
      nativeLang: body.nativeLang,
      targetLang: body.targetLang,
      level: body.level,
    })
    startSession(c, user.id)
    seedStarterDecks(deps.db, user.id)
    return c.json({ user: publicUser(user) }, 201)
  })

  app.post('/api/auth/login', async (c) => {
    const deps = c.get('deps')
    const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string }
    const username = body.username?.trim() ?? ''
    const user = username ? getUserByUsername(deps.db, username) : undefined
    if (!user?.passwordHash || !(await verifyPassword(body.password ?? '', user.passwordHash))) {
      return c.json({ error: 'invalid username or password' }, 401)
    }
    startSession(c, user.id)
    return c.json({ user: publicUser(user) })
  })

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) deleteAuthSession(c.get('deps').db, tokenId(token))
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', (c) => {
    const user = currentUser(c)
    return c.json({ user: user ? publicUser(user) : null })
  })

  app.put('/api/auth/me', async (c) => {
    const user = currentUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, string>
    const patch: Record<string, string> = {}
    for (const k of ['handle', 'nativeLang', 'targetLang', 'level']) {
      if (typeof body[k] === 'string' && body[k]) patch[k] = body[k]
    }
    if (Object.keys(patch).length) updateUser(c.get('deps').db, user.id, patch)
    return c.json({ user: publicUser(getUserById(c.get('deps').db, user.id)!) })
  })

  // --- admin: manage accounts (keeps everyone's data separate) ---
  app.get('/api/users', (c) => {
    const user = currentUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
    return c.json({ users: listUsers(c.get('deps').db) })
  })

  app.delete('/api/users/:id', (c) => {
    const user = currentUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
    const target = c.req.param('id')
    if (target === user.id) return c.json({ error: 'cannot delete yourself' }, 400)
    deleteUserAuthSessions(c.get('deps').db, target)
    deleteUser(c.get('deps').db, target)
    return c.json({ ok: true })
  })
}
