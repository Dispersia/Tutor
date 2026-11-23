import type { UserId } from '../../ids'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { SESSION_COOKIE, newSessionToken, tokenId } from '../../auth'
import { deleteAuthSession, getAuthSessionUser, insertAuthSession } from '../../db/repo'
import type { AppEnv } from '../../context'
import { env } from '../../env'

const COOKIE_PATH = env.basePath || '/'

function isHttps(c: Context<AppEnv>): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true
  return c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
}

export function currentUser(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return undefined
  return getAuthSessionUser(deps.db, tokenId(token))
}

export function startSession(c: Context<AppEnv>, userId: UserId): void {
  const deps = c.get('deps')
  const token = newSessionToken()
  insertAuthSession(deps.db, tokenId(token), userId, deps.sessionTtlMs, c.req.header('user-agent'))
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: COOKIE_PATH,
    secure: isHttps(c),
    maxAge: Math.floor(deps.sessionTtlMs / 1000),
  })
}

export function endSession(c: Context<AppEnv>): void {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) deleteAuthSession(c.get('deps').db, tokenId(token))
  deleteCookie(c, SESSION_COOKIE, { path: COOKIE_PATH })
  if (COOKIE_PATH !== '/') deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
