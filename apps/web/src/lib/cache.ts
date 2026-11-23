/**
 * Client-side read cache for GET responses.
 *
 * The app is a PWA that has to stay usable on a spotty or absent connection.
 * Without a cache two things break: an SPA route change blanks every screen to
 * its loading state and refetches (the "flash"), and a cold open with no network
 * shows nothing at all. So every successful GET is kept in memory — instant,
 * flash-free navigation — and the handful of small payloads a screen seeds
 * itself from (`SEEDS`) are mirrored to localStorage so a cold open renders the
 * last known data. Everything else (one entry per conversation, search results,
 * …) is unbounded in number, so it stays in memory and never eats the ~5 MB
 * quota. Reads never block on the network: a page seeds itself from
 * `peekCached` and revalidates in the background.
 */

const PREFIX = 'tutor.cache.'
/** Entries larger than this stay in memory only, to spare the ~5 MB quota. */
const MAX_PERSIST_BYTES = 1_500_000

/** The "screen seed" GETs a cold open paints from; exact paths, no query. */
const SEEDS = new Set([
  '/api/stats',
  '/api/skills',
  '/api/skills/gear',
  '/api/srs/stats',
  '/api/curriculum',
  '/api/decks',
  '/api/settings',
  '/api/combat',
  '/api/sessions',
])
/** One skill's page: a fixed, small set of ids (never a query or a sub-path). */
const SKILL_PAGE = /^\/api\/skills\/[\w-]+$/

/** Whether a GET path is mirrored to localStorage (the rest is memory only). */
export function isPersisted(path: string): boolean {
  return SEEDS.has(path) || SKILL_PAGE.test(path)
}

interface Entry {
  data: unknown
  /** epoch ms of the fetch that produced `data` */
  at: number
}

const memory = new Map<string, Entry>()
let hydrated = false

/** Every cache key in localStorage, read up front so removals cannot skip one. */
function storedKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  return keys
}

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  if (typeof localStorage === 'undefined') return
  try {
    for (const key of storedKeys()) hydrateKey(key)
  } catch {
    // A corrupt or unreadable store must never break boot.
  }
}

/** Loads one stored entry, dropping what an older build persisted off the list. */
function hydrateKey(key: string): void {
  const path = key.slice(PREFIX.length)
  if (!isPersisted(path)) {
    localStorage.removeItem(key)
    return
  }
  const raw = localStorage.getItem(key)
  if (!raw) return
  const entry = JSON.parse(raw) as Entry
  if (entry && typeof entry.at === 'number' && !memory.has(path)) memory.set(path, entry)
}

/** The last cached value for a GET path, or undefined when none was stored. */
export function peekCached<T>(path: string): T | undefined {
  hydrate()
  return memory.get(path)?.data as T | undefined
}

/** Epoch ms the cached value for a path was fetched (0 when there is none). */
export function cachedAt(path: string): number {
  hydrate()
  return memory.get(path)?.at ?? 0
}

/** Stores a GET response in memory and, for a screen seed, in localStorage. */
export function writeCache(path: string, data: unknown): void {
  hydrate()
  const entry: Entry = { data, at: Date.now() }
  memory.set(path, entry)
  if (typeof localStorage === 'undefined' || !isPersisted(path)) return
  try {
    const raw = JSON.stringify(entry)
    if (raw.length > MAX_PERSIST_BYTES) localStorage.removeItem(PREFIX + path)
    else persist(path, raw)
  } catch {
    // Unserialisable or unreadable store: the in-memory copy still serves.
  }
}

/**
 * Writes one entry, making room on a full quota by evicting the oldest other
 * entries. When nothing is left to evict the stale copy is removed, so a cold
 * open never paints data older than what this session already replaced.
 */
function persist(path: string, raw: string): void {
  for (;;) {
    try {
      localStorage.setItem(PREFIX + path, raw)
      return
    } catch {
      if (evictOldest(path)) continue
      localStorage.removeItem(PREFIX + path)
      return
    }
  }
}

/** Removes the oldest persisted entry other than `keep`; false when none is left. */
function evictOldest(keep: string): boolean {
  const others = storedKeys().filter((k) => k !== PREFIX + keep)
  if (!others.length) return false
  const age = (key: string) => memory.get(key.slice(PREFIX.length))?.at ?? 0
  localStorage.removeItem(others.reduce((a, b) => (age(b) < age(a) ? b : a)))
  return true
}

/** Drops every cached response (on sign-in/out, so accounts never share data). */
export function clearCache(): void {
  memory.clear()
  if (typeof localStorage === 'undefined') return
  try {
    for (const key of storedKeys()) localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
