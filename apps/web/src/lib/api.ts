import { apiPath } from './paths'
import { peekCached, writeCache } from './cache'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** In-flight GETs, so several screens opening together share one request. */
const inflight = new Map<string, Promise<unknown>>()

/**
 * fetch wrapper: JSON by default, cookie credentials, typed errors.
 *
 * GET responses are cached (see ./cache) so an SPA route change can render the
 * last known data at once, and a network failure falls back to that cache
 * instead of throwing — which keeps the app usable offline. Real HTTP errors
 * (401, 404, …) always surface so auth and not-found handling stay correct.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const cacheable = method === 'GET'
  if (cacheable) {
    const pending = inflight.get(path)
    if (pending) return pending as Promise<T>
  }
  const run = () => runRequest<T>(path, init, cacheable)
  if (!cacheable) return run()
  const promise = run().finally(() => inflight.delete(path))
  inflight.set(path, promise)
  return promise
}

async function runRequest<T>(path: string, init: RequestInit, cacheable: boolean): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  let res: Response
  try {
    res = await fetch(apiPath(path), { credentials: 'same-origin', ...init, headers })
  } catch (err) {
    const cached = cacheable ? peekCached<T>(path) : undefined
    if (cached !== undefined) return cached
    throw err
  }
  if (!res.ok) throw await apiError(res)
  const data = await parseBody<T>(res)
  if (cacheable) writeCache(path, data)
  return data
}

/** The typed error a non-2xx response becomes (its `error` field, or raw text). */
async function apiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '')
  let msg = text
  try {
    msg = (JSON.parse(text) as { error?: string }).error ?? text
  } catch {
    // keep raw text
  }
  return new ApiError(res.status, msg || res.statusText)
}

async function parseBody<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json')
    ? ((await res.json()) as T)
    : ((await res.text()) as unknown as T)
}

export function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) }
}
