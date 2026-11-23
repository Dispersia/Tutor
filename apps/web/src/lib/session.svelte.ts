import { api, ApiError, onUnauthorized } from './api'
import { clearCache } from './cache'
import type { PublicUser } from './types'

const USER_KEY = 'tutor.user'

function readStoredUser(): PublicUser | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as PublicUser) : null
  } catch {
    return null
  }
}

function persistUser(user: PublicUser | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {}
}

const stored = readStoredUser()

class SessionState {
  user = $state<PublicUser | null>(stored)
  loaded = $state(stored !== null)
}

export const session = new SessionState()

onUnauthorized(() => {
  persistUser(null)
  session.user = null
  session.loaded = true
})

export async function loadUser(): Promise<void> {
  try {
    const r = await api<{ user: PublicUser | null }>('/api/auth/me')
    session.user = r.user
    persistUser(r.user)
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      clearCache()
      persistUser(null)
      session.user = null
    } else {
      session.user = session.user ?? readStoredUser()
    }
  } finally {
    session.loaded = true
  }
}

export async function login(username: string, password: string): Promise<PublicUser> {
  const r = await api<{ user: PublicUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  clearCache()
  session.user = r.user
  persistUser(r.user)
  return r.user
}

export async function register(
  username: string,
  password: string,
  opts: { handle?: string; targetLang?: string; level?: string } = {},
): Promise<PublicUser> {
  const r = await api<{ user: PublicUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...opts }),
  })
  clearCache()
  session.user = r.user
  persistUser(r.user)
  return r.user
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
  clearCache()
  persistUser(null)
  session.user = null
}

export async function updateProfile(patch: Partial<PublicUser>): Promise<void> {
  const r = await api<{ user: PublicUser }>('/api/auth/me', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  session.user = r.user
  persistUser(r.user)
}
