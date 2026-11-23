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
  } catch {
    // A full quota must not block sign-in.
  }
}

const stored = readStoredUser()

class SessionState {
  user = $state<PublicUser | null>(stored)
  /**
   * True once the member is known. With a stored user the app renders at once
   * (no "Loading…" flash on a cold open); otherwise we wait for /api/auth/me so
   * a signed-out visitor never sees a protected screen.
   */
  loaded = $state(stored !== null)
}

export const session = new SessionState()

// A 401 on any data route means the cookie expired mid-session: forget the
// member, so the layout redirects to the login screen (api.ts has already
// dropped the cached data).
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
    // A rejected cookie means signed out — drop everything. Anything else is a
    // network failure, so keep the stored member and let the app open offline.
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
  // A fresh account starts clean — never inherit the last member's cache.
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
  // Offline or already expired: this device must still forget the member.
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
