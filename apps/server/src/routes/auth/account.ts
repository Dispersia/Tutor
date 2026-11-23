import type { Context } from 'hono'
import { getUserById, getUserByUsername, publicUser, registerUser, updateUser } from '../../db/repo'
import { hashPassword, verifyPassword } from '../../auth'
import type { App, AppEnv } from '../../context'
import { jsonBody, str } from '../body'
import { currentUser, endSession, startSession } from './session'
import { clearFailures, noteFailure, retryAfterSec } from './throttle'
import { fail, failWith, guardError, type GuardError } from '../errors'

interface RegisterBody {
  username?: string
  password?: string
  handle?: string
  nativeLang?: string
  targetLang?: string
  level?: string
}

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
  if (invalid) return failWith(c, invalid)
  const account = newAccount(body, username!, await hashPassword(password))
  const made = registerUser(deps.db, account, deps.allowRegistration)
  if ('error' in made) return fail(c, STATUS[made.error], REGISTER_ERRORS[made.error])
  startSession(c, made.user.id)
  return c.json({ user: publicUser(made.user) }, 201)
}

const REGISTER_ERRORS = {
  taken: 'username already taken',
  closed: 'registration is disabled on this server',
} as const
const STATUS = { taken: 409, closed: 403 } as const

function validateRegister(username: string | undefined, password: string): GuardError | undefined {
  if (!username || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
    return guardError(400, 'username must be 2-32 chars: letters, digits, . _ -')
  }
  if (password.length < 8) {
    return guardError(400, 'password must be at least 8 characters')
  }
  return undefined
}

function newAccount(body: RegisterBody, username: string, passwordHash: string) {
  return {
    username,
    passwordHash,
    handle: body.handle?.trim() || username,
    nativeLang: body.nativeLang,
    targetLang: body.targetLang,
    level: body.level,
  }
}

async function loginHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const body = await jsonBody(c)
  const username = str(body, 'username')?.trim() ?? ''
  const wait = retryAfterSec(username)
  if (wait > 0) return tooManyAttempts(c, wait)
  const user = username ? getUserByUsername(deps.db, username) : undefined
  const hash = user?.passwordHash ?? (await dummyHash())
  const ok = await verifyPassword(str(body, 'password') ?? '', hash)
  if (!user?.passwordHash || !ok) {
    noteFailure(username)
    return fail(c, 401, 'invalid username or password')
  }
  clearFailures(username)
  startSession(c, user.id)
  return c.json({ user: publicUser(user) })
}

let dummy: Promise<string> | undefined
const dummyHash = (): Promise<string> => (dummy ??= hashPassword(crypto.randomUUID()))

function tooManyAttempts(c: Context<AppEnv>, waitSec: number) {
  c.header('Retry-After', String(waitSec))
  return fail(c, 429, 'too many attempts — try again in a few minutes')
}

function meView(c: Context<AppEnv>) {
  const user = currentUser(c)
  return user ? publicUser(user) : null
}

async function updateMe(c: Context<AppEnv>) {
  const user = currentUser(c)
  if (!user) return fail(c, 401, 'unauthorized')
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
