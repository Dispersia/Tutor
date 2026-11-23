import { apiPath } from './paths'
import { clearCache, peekCached, writeCache } from './cache'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface Pending {
  /** The mutation generation the request was started in. */
  gen: number
  promise: Promise<unknown>
}

/** In-flight GETs, so several screens opening together share one request. */
const inflight = new Map<string, Pending>()
/**
 * Bumped when a mutation starts and again when it settles. A GET started in an
 * older generation may carry pre-mutation data, so it is never joined and never
 * overwrites what a newer GET cached.
 */
let generation = 0
/** The generation of the GET that last wrote each path to the cache. */
const written = new Map<string, number>()

let unauthorized: (() => void) | null = null

/**
 * Registers what to do when the server rejects the cookie (the session module
 * signs the member out). A callback, so this module never imports the session.
 */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorized = handler
}

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
  if (method !== 'GET') return mutate<T>(path, init)
  const pending = inflight.get(path)
  if (pending && pending.gen === generation) return pending.promise as Promise<T>
  const entry: Pending = { gen: generation, promise: Promise.resolve() }
  entry.promise = runRequest<T>(path, init, entry.gen).finally(() => {
    if (inflight.get(path) === entry) inflight.delete(path)
  })
  inflight.set(path, entry)
  return entry.promise as Promise<T>
}

/** A non-GET: every GET in flight around it is stale from here on. */
async function mutate<T>(path: string, init: RequestInit): Promise<T> {
  generation++
  try {
    return await runRequest<T>(path, init, null)
  } finally {
    generation++
  }
}

/** Runs one request; `gen` is the GET's generation, or null for a mutation. */
async function runRequest<T>(path: string, init: RequestInit, gen: number | null): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  let res: Response
  try {
    res = await fetch(apiPath(path), { credentials: 'same-origin', ...init, headers })
  } catch (err) {
    const cached = gen === null ? undefined : peekCached<T>(path)
    if (cached !== undefined) return cached
    throw err
  }
  if (!res.ok) throw await apiError(path, res)
  const data = await parseBody<T>(res)
  if (gen !== null) cacheFresh(path, data, gen)
  return data
}

/** Caches a GET unless a GET from a newer generation already did. */
function cacheFresh(path: string, data: unknown, gen: number): void {
  if (gen < (written.get(path) ?? 0)) return
  written.set(path, gen)
  writeCache(path, data)
}

/** The typed error a non-2xx response becomes (its `error` field, or raw text). */
async function apiError(path: string, res: Response): Promise<ApiError> {
  if (res.status === 401) signedOut(path)
  const text = await res.text().catch(() => '')
  let msg = text
  try {
    msg = (JSON.parse(text) as { error?: string }).error ?? text
  } catch {
    // keep raw text
  }
  return new ApiError(res.status, msg || res.statusText)
}

/**
 * An expired cookie: forget the cached data and tell the session, so the layout
 * sends the member to the login screen. The auth routes answer 401 for their
 * own reasons (a wrong password, the `/me` probe) and handle it themselves.
 */
function signedOut(path: string): void {
  if (path.startsWith('/api/auth/')) return
  clearCache()
  written.clear()
  unauthorized?.()
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
