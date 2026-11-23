const PREFIX = 'tutor.cache.'
const MAX_PERSIST_BYTES = 1_500_000

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
const SKILL_PAGE = /^\/api\/skills\/[\w-]+$/

export function isPersisted(path: string): boolean {
  return SEEDS.has(path) || SKILL_PAGE.test(path)
}

interface Entry {
  data: unknown
  at: number
}

const memory = new Map<string, Entry>()
let hydrated = false

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
  } catch {}
}

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

export function peekCached<T>(path: string): T | undefined {
  hydrate()
  return memory.get(path)?.data as T | undefined
}

export function cachedAt(path: string): number {
  hydrate()
  return memory.get(path)?.at ?? 0
}

export function writeCache(path: string, data: unknown): void {
  hydrate()
  const entry: Entry = { data, at: Date.now() }
  memory.set(path, entry)
  if (typeof localStorage === 'undefined' || !isPersisted(path)) return
  try {
    const raw = JSON.stringify(entry)
    if (raw.length > MAX_PERSIST_BYTES) localStorage.removeItem(PREFIX + path)
    else persist(path, raw)
  } catch {}
}

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

function evictOldest(keep: string): boolean {
  const others = storedKeys().filter((k) => k !== PREFIX + keep)
  if (!others.length) return false
  const age = (key: string) => memory.get(key.slice(PREFIX.length))?.at ?? 0
  localStorage.removeItem(others.reduce((a, b) => (age(b) < age(a) ? b : a)))
  return true
}

export function clearCache(): void {
  memory.clear()
  if (typeof localStorage === 'undefined') return
  try {
    for (const key of storedKeys()) localStorage.removeItem(key)
  } catch {}
}
