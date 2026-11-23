/**
 * One cached GET as reactive state: the block every screen used to hand-copy.
 *
 * A resource seeds itself synchronously from the read cache (`lib/cache.ts`), so
 * a returning screen paints the last known payload at once, then revalidates in
 * the background. `loading` is true only while there is nothing to show; a
 * failed fetch keeps the data it has and fills `error` — it never throws into
 * the component.
 *
 * Two ways to fetch, by who handles the failure:
 * - `refresh()` never rejects: the failure lands in `error` (a screen's banner).
 * - `load()` rejects with the fetch's own error and leaves `error` alone, for a
 *   caller that must stop on a failure, shows it in a slot of its own, or polls
 *   and drops it. It resolves with the payload, so the caller can use it at once.
 *
 * `error` is the screen's one error slot: a load writes it on failure, and the
 * screen may write it too (a failed mutation) and clears it when it starts
 * something new. A load never clears it by itself, so a message a mutation left
 * survives the refetch that follows; opening another path does clear it.
 *
 * The pure parts (`sequence`, `seedState`, `loadState`, `loadOrThrow`) take a
 * plain object, so they are tested without a DOM (`resource.test.ts`).
 */
import { untrack } from 'svelte'
import { api } from './api'
import { cachedAt, peekCached } from './cache'

/** The fields a load writes; the rune class and a plain test object both fit. */
export interface ResourceState<T> {
  /** The payload, or undefined while nothing was cached or fetched. */
  data: T | undefined
  /** True while there is no payload to show and a fetch has not settled. */
  loading: boolean
  /** The last failure's message ('' when none). */
  error: string
  /** Epoch ms `data` was fetched: the cache's own stamp for an offline fallback. */
  fetchedAt: number
}

export interface ResourceOptions<T> {
  /** How to fetch a path; defaults to the cached `api` GET. */
  fetch?: (path: string) => Promise<T>
  /** The message `refresh()` reports for a failure that carries none. */
  fallback?: string
  /**
   * `cachedResource` only: false leaves the first fetch to the caller, for a
   * screen that awaits `refresh()` or `load()` alongside its other requests.
   */
  auto?: boolean
}

/** Read access to the GET cache (swapped for a fake in tests). */
export interface CacheReader {
  peek: <T>(path: string) => T | undefined
  at: (path: string) => number
}

const CACHE: CacheReader = { peek: peekCached, at: cachedAt }

/** Numbers requests so only the latest one may write its answer. */
export interface Sequence {
  /** Starts a request: every earlier ticket is stale from here on. */
  next: () => number
  isLatest: (ticket: number) => boolean
}

export function sequence(): Sequence {
  let latest = 0
  return { next: () => ++latest, isLatest: (ticket) => ticket === latest }
}

/** Resets a state to what the cache holds for a path (nothing → a loading blank). */
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

/** One request, as `loadState` runs it. */
export interface LoadRequest<T> {
  fetch: () => Promise<T>
  /** False once a newer request (or another path) has superseded this one. */
  current: () => boolean
  /** Epoch ms to stamp a fresh payload with. */
  stamp: () => number
  fallback?: string
}

function applyPayload<T>(state: ResourceState<T>, data: T, at: number): void {
  state.data = data
  state.fetchedAt = at
  state.loading = false
}

/**
 * Runs one fetch into a state. Resolves true when its payload was applied, and
 * false when it failed (`error` is set) or was superseded (nothing is touched:
 * the newer request settles the state).
 */
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

/**
 * `loadState` for a caller that handles the failure itself. Resolves with the
 * payload this request fetched — applied to the state unless the request was
 * superseded — and rejects with the fetch's own error, untouched. `error` is
 * never written (the rejection is the report), and a superseded request leaves
 * the state alone whether it worked or not.
 */
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

/**
 * The reactive resource. Built without an effect, so a module can hold one as a
 * shared store (`lib/skills/store.svelte.ts`); a component uses `cachedResource`.
 */
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

  /** Points the resource at another path, re-seeding from the cache when it changed. */
  open(path: string | undefined): void {
    if (path === this.#path) return
    this.#path = path
    this.reseed()
  }

  /** Adopts whatever the cache holds now and drops any request still in flight. */
  reseed(): void {
    this.#seq.next()
    seedState(this, this.#path)
  }

  /** Fetches the path again. Never rejects: true when the fresh payload was applied. */
  refresh(): Promise<boolean> {
    const path = this.#path
    if (path === undefined) return Promise.resolve(false)
    return loadState<T>(this, this.#request(path))
  }

  /**
   * Fetches the path again for a caller that handles the failure itself:
   * resolves with the payload and rejects with the fetch's error. `error` is
   * left alone, so a poll can drop a failure and a flow can show it elsewhere.
   * The payload is applied unless a newer request or `set` superseded this one.
   */
  load(): Promise<T> {
    const path = this.#path
    if (path === undefined) return Promise.reject(new Error('Nothing to load'))
    return loadOrThrow<T>(this, this.#request(path))
  }

  /** Starts a request: every earlier one is stale from here on. */
  #request(path: string): LoadRequest<T> {
    const ticket = this.#seq.next()
    return {
      fetch: () => (this.#opts.fetch ? this.#opts.fetch(path) : api<T>(path)),
      current: () => this.#seq.isLatest(ticket),
      stamp: () => cachedAt(path) || Date.now(),
      fallback: this.#opts.fallback,
    }
  }

  /** Takes a payload the caller already has (a mutation's reply) instead of refetching. */
  set(data: T): void {
    this.#seq.next()
    this.data = data
    this.fetchedAt = Date.now()
    this.loading = false
  }
}

/**
 * A resource owned by the calling component: seeded from the cache during
 * component init, fetched once it mounts, and re-opened (seed, then fetch)
 * whenever a getter path changes — a route param, say. An undefined path waits.
 */
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
