import { api } from './api'
import type { PublicUser } from './types'

class SessionState {
  user = $state<PublicUser | null>(null)
  loaded = $state(false)
}

export const session = new SessionState()

export async function loadUser(): Promise<void> {
  try {
    const r = await api<{ user: PublicUser | null }>('/api/auth/me')
    session.user = r.user
  } catch {
    session.user = null
  } finally {
    session.loaded = true
  }
}

export async function login(username: string, password: string): Promise<PublicUser> {
  const r = await api<{ user: PublicUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  session.user = r.user
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
  session.user = r.user
  return r.user
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' })
  session.user = null
}

export async function updateProfile(patch: Partial<PublicUser>): Promise<void> {
  const r = await api<{ user: PublicUser }>('/api/auth/me', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  session.user = r.user
}
