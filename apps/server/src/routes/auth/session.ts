/** Auth sessions: the signed-in user and starting a session (docs/DESIGN.md §12.5). */

import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { SESSION_COOKIE, newSessionToken, tokenId } from '../../auth'
import { deleteAuthSession, getAuthSessionUser, insertAuthSession } from '../../db/repo'
import type { AppEnv } from '../../context'

function isHttps(c: Context<AppEnv>): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true
  // behind a TLS-terminating proxy (Caddy / `tailscale serve`)
  return c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
}

export function currentUser(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return undefined
  return getAuthSessionUser(deps.db, tokenId(token))
}

export function startSession(c: Context<AppEnv>, userId: string): void {
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

export function endSession(c: Context<AppEnv>): void {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) deleteAuthSession(c.get('deps').db, tokenId(token))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
