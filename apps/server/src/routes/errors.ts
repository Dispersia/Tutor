/**
 * The one shape for HTTP errors in the routes: `{ error: message, ...extra }`
 * under a 4xx/5xx status. Handlers answer with `fail`; a guard that runs before
 * the use case returns a `GuardError` for the handler to send with `failWith`.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../context'

/** Every status a route answers an error with. */
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503

/** An error a guard returns before the handler runs its use case. */
export interface GuardError {
  status: ErrorStatus
  /** the response body: `error` is the message, the rest is detail for the client */
  body: Record<string, unknown>
}

/** Builds a `GuardError` in the routes' error shape. */
export function guardError(
  status: ErrorStatus,
  message: string,
  extra?: Record<string, unknown>,
): GuardError {
  return { status, body: { error: message, ...extra } }
}

/** Answers `{ error: message, ...extra }` under `status`. */
export function fail(
  c: Context<AppEnv>,
  status: ErrorStatus,
  message: string,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: message, ...extra }, status)
}

/** Answers with the error a guard returned. */
export function failWith(c: Context<AppEnv>, err: GuardError) {
  return c.json(err.body, err.status)
}

export const NO_KEY_MESSAGE = 'No OpenRouter key — add one in Settings.'

/**
 * The answer when a use case needs an OpenRouter key and the member has none
 * (nor the server). A 409: the request is fine, the account's configuration is
 * not — it is no bad gateway.
 */
export function needKey(c: Context<AppEnv>) {
  return fail(c, 409, NO_KEY_MESSAGE)
}
