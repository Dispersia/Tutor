import type { Context } from 'hono'
import type { AppEnv } from '../context'

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503

export interface GuardError {
  status: ErrorStatus
  body: Record<string, unknown>
}

export function guardError(
  status: ErrorStatus,
  message: string,
  extra?: Record<string, unknown>,
): GuardError {
  return { status, body: { error: message, ...extra } }
}

export function fail(
  c: Context<AppEnv>,
  status: ErrorStatus,
  message: string,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: message, ...extra }, status)
}

export function failWith(c: Context<AppEnv>, err: GuardError) {
  return c.json(err.body, err.status)
}

export const NO_KEY_MESSAGE = 'No OpenRouter key — add one in Settings.'

export function needKey(c: Context<AppEnv>) {
  return fail(c, 409, NO_KEY_MESSAGE)
}
