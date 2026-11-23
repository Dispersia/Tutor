import { untrack } from 'svelte'
import { api } from './api'
import { cachedAt, peekCached } from './cache'

export interface ResourceState<T> {
  data: T | undefined
  loading: boolean
  error: string
  fetchedAt: number
}

export interface ResourceOptions<T> {
  fetch?: (path: string) => Promise<T>
  fallback?: string
  auto?: boolean
}

export interface CacheReader {
  peek: <T>(path: string) => T | undefined
  at: (path: string) => number
}

const CACHE: CacheReader = { peek: peekCached, at: cachedAt }

export interface Sequence {
  next: () => number
  isLatest: (ticket: number) => boolean
}

export function sequence(): Sequence {
  let latest = 0
  return { next: () => ++latest, isLatest: (ticket) => ticket === latest }
}

export function seedState<T>(
  state: ResourceState<T>,
  path: string | undefined,
  cache: CacheReader = CACHE,
): void {
  const cached = path === undefined ? undefined : cache.peek<T>(path)
  state.data = cached
  state.fetchedAt = path === undefined || cached === undefined ? 0 : cache.at(path)
  state.loading = cached === undefined
  state.error = ''
}

export interface LoadRequest<T> {
  fetch: () => Promise<T>
  current: () => boolean
  stamp: () => number
  fallback?: string
}

function applyPayload<T>(state: ResourceState<T>, data: T, at: number): void {
  state.data = data
  state.fetchedAt = at
  state.loading = false
}

export async function loadState<T>(state: ResourceState<T>, req: LoadRequest<T>): Promise<boolean> {
  if (state.data === undefined) state.loading = true
  try {
    const data = await req.fetch()
    if (!req.current()) return false
    applyPayload(state, data, req.stamp())
    return true
  } catch (e) {
    if (!req.current()) return false
    state.error = (e as Error).message || (req.fallback ?? '')
    state.loading = false
    return false
  }
}

export async function loadOrThrow<T>(state: ResourceState<T>, req: LoadRequest<T>): Promise<T> {
  if (state.data === undefined) state.loading = true
  try {
    const data = await req.fetch()
    if (req.current()) applyPayload(state, data, req.stamp())
    return data
  } catch (e) {
    if (req.current()) state.loading = false
    throw e
  }
}

export class Resource<T> implements ResourceState<T> {
  data = $state.raw<T | undefined>(undefined)
  loading = $state(true)
  error = $state('')
  fetchedAt = $state(0)

  #path: string | undefined
  readonly #opts: ResourceOptions<T>
  readonly #seq = sequence()

  constructor(path: string | undefined, opts: ResourceOptions<T> = {}) {
    this.#path = path
    this.#opts = opts
    this.reseed()
  }

  get path(): string | undefined {
    return this.#path
  }

  open(path: string | undefined): void {
    if (path === this.#path) return
    this.#path = path
    this.reseed()
  }

  reseed(): void {
    this.#seq.next()
    seedState(this, this.#path)
  }

  refresh(): Promise<boolean> {
    const path = this.#path
    if (path === undefined) return Promise.resolve(false)
    return loadState<T>(this, this.#request(path))
  }

  load(): Promise<T> {
    const path = this.#path
    if (path === undefined) return Promise.reject(new Error('Nothing to load'))
    return loadOrThrow<T>(this, this.#request(path))
  }

  #request(path: string): LoadRequest<T> {
    const ticket = this.#seq.next()
    return {
      fetch: () => (this.#opts.fetch ? this.#opts.fetch(path) : api<T>(path)),
      current: () => this.#seq.isLatest(ticket),
      stamp: () => cachedAt(path) || Date.now(),
      fallback: this.#opts.fallback,
    }
  }

  set(data: T): void {
    this.#seq.next()
    this.data = data
    this.fetchedAt = Date.now()
    this.loading = false
  }
}

export function cachedResource<T>(
  path: string | (() => string | undefined),
  opts: ResourceOptions<T> = {},
): Resource<T> {
  const read = typeof path === 'function' ? path : () => path
  const resource = new Resource<T>(read(), opts)
  if (opts.auto === false) return resource
  $effect(() => {
    const next = read()
    untrack(() => {
      resource.open(next)
      void resource.refresh()
    })
  })
  return resource
}
