/**
 * Client-side read cache for GET responses.
 *
 * The app is a PWA that has to stay usable on a spotty or absent connection.
 * Without a cache two things break: an SPA route change blanks every screen to
 * its loading state and refetches (the "flash"), and a cold open with no network
 * shows nothing at all. So every successful GET is kept in memory — instant,
 * flash-free navigation — and mirrored to localStorage so a cold open renders
 * the last known data. Reads never block on the network: a page seeds itself
 * from `peekCached` and revalidates in the background.
 */

const PREFIX = 'tutor.cache.'
/** Entries larger than this stay in memory only, to spare the ~5 MB quota. */
const MAX_PERSIST_BYTES = 1_500_000

interface Entry {
  data: unknown
  /** epoch ms of the fetch that produced `data` */
  at: number
}

const memory = new Map<string, Entry>()
let hydrated = false

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  if (typeof localStorage === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const entry = JSON.parse(raw) as Entry
      if (entry && typeof entry.at === 'number') memory.set(key.slice(PREFIX.length), entry)
    }
  } catch {
    // A corrupt or unreadable store must never break boot.
  }
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

/** Stores a GET response in memory and, best effort, in localStorage. */
export function writeCache(path: string, data: unknown): void {
  memory.set(path, { data, at: Date.now() })
  if (typeof localStorage === 'undefined') return
  try {
    const raw = JSON.stringify({ data, at: Date.now() })
    if (raw.length > MAX_PERSIST_BYTES) return
    localStorage.setItem(PREFIX + path, raw)
  } catch {
    // Quota exceeded: the in-memory copy still makes navigation instant.
  }
}

/** Drops every cached response (on sign-in/out, so accounts never share data). */
export function clearCache(): void {
  memory.clear()
  if (typeof localStorage === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
