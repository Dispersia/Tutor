import { href } from './paths'
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
  gen: number
  promise: Promise<unknown>
}

const inflight = new Map<string, Pending>()
let generation = 0
const written = new Map<string, number>()

let unauthorized: (() => void) | null = null

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorized = handler
}

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

async function mutate<T>(path: string, init: RequestInit): Promise<T> {
  generation++
  try {
    return await runRequest<T>(path, init, null)
  } finally {
    generation++
  }
}

async function runRequest<T>(path: string, init: RequestInit, gen: number | null): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  let res: Response
  try {
    res = await fetch(href(path), { credentials: 'same-origin', ...init, headers })
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

function cacheFresh(path: string, data: unknown, gen: number): void {
  if (gen < (written.get(path) ?? 0)) return
  written.set(path, gen)
  writeCache(path, data)
}

async function apiError(path: string, res: Response): Promise<ApiError> {
  if (res.status === 401) signedOut(path)
  const text = await res.text().catch(() => '')
  let msg = text
  try {
    msg = (JSON.parse(text) as { error?: string }).error ?? text
  } catch {}
  return new ApiError(res.status, msg || res.statusText)
}

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
