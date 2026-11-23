import { beforeEach, expect, test } from 'bun:test'
import { cachedAt, clearCache, isPersisted, peekCached, writeCache } from './cache'

/** A localStorage stand-in that throws once `limit` characters are stored. */
class FakeStorage {
  map = new Map<string, string>()
  limit = Infinity
  get length() {
    return this.map.size
  }
  key = (i: number) => [...this.map.keys()][i] ?? null
  getItem = (k: string) => this.map.get(k) ?? null
  removeItem = (k: string) => void this.map.delete(k)
  setItem(k: string, v: string) {
    let used = v.length
    for (const [key, value] of this.map) if (key !== k) used += value.length
    if (used > this.limit) throw new Error('QuotaExceededError')
    this.map.set(k, v)
  }
}

const store = new FakeStorage()
Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })

beforeEach(() => {
  clearCache()
  store.map.clear()
  store.limit = Infinity
})

test('only the screen-seed paths are on the persist list', () => {
  expect(isPersisted('/api/skills')).toBe(true)
  expect(isPersisted('/api/stats')).toBe(true)
  expect(isPersisted('/api/skills/mining')).toBe(true)
  expect(isPersisted('/api/sessions/abc')).toBe(false)
  expect(isPersisted('/api/skills?x=1')).toBe(false)
  expect(isPersisted('/api/decks/d1/cards')).toBe(false)
  expect(isPersisted('/api/rigs')).toBe(false)
})

test('a seed path is mirrored to localStorage; anything else stays in memory', () => {
  writeCache('/api/stats', { xp: 1 })
  writeCache('/api/sessions/abc', { messages: [] })
  expect([...store.map.keys()]).toEqual(['tutor.cache./api/stats'])
  expect(peekCached<{ messages: unknown[] }>('/api/sessions/abc')).toEqual({ messages: [] })
  expect(cachedAt('/api/sessions/abc')).toBeGreaterThan(0)
})

test('a full quota evicts older entries instead of dropping the new one', () => {
  writeCache('/api/stats', { pad: 'x'.repeat(200) })
  writeCache('/api/decks', { pad: 'y'.repeat(200) })
  store.limit = 500
  writeCache('/api/skills', { pad: 'z'.repeat(300) })
  expect(store.map.has('tutor.cache./api/skills')).toBe(true)
  expect(store.map.size).toBeLessThan(3)
  // Evicted from disk only: this session still has every payload in memory.
  expect(peekCached('/api/stats')).toBeDefined()
})

test('an entry that cannot fit at all leaves no stale copy behind', () => {
  writeCache('/api/stats', { v: 1 })
  store.limit = 10
  writeCache('/api/stats', { v: 2 })
  expect(store.map.size).toBe(0)
  expect(peekCached<{ v: number }>('/api/stats')).toEqual({ v: 2 })
})
