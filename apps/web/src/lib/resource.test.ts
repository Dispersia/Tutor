import { expect, test } from 'bun:test'
import {
  loadOrThrow,
  loadState,
  seedState,
  sequence,
  type CacheReader,
  type ResourceState,
} from './resource.svelte'

const blank = <T>(): ResourceState<T> => ({
  data: undefined,
  loading: false,
  error: 'old',
  fetchedAt: 9,
})

const cacheOf = (path: string, data: unknown, at: number): CacheReader => ({
  peek: <T>(p: string) => (p === path ? (data as T) : undefined),
  at: (p) => (p === path ? at : 0),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('sequence: only the newest ticket is the latest', () => {
  const seq = sequence()
  const first = seq.next()
  expect(seq.isLatest(first)).toBe(true)
  const second = seq.next()
  expect(seq.isLatest(first)).toBe(false)
  expect(seq.isLatest(second)).toBe(true)
})

test('seedState: a cached path paints at once with the cache stamp', () => {
  const state = blank<{ n: number }>()
  seedState(state, '/api/x', cacheOf('/api/x', { n: 1 }, 1234))
  expect(state).toEqual({ data: { n: 1 }, loading: false, error: '', fetchedAt: 1234 })
})

test('seedState: an uncached or missing path is a loading blank', () => {
  const state = blank<{ n: number }>()
  state.data = { n: 7 }
  seedState(state, '/api/other', cacheOf('/api/x', { n: 1 }, 1234))
  expect(state).toEqual({ data: undefined, loading: true, error: '', fetchedAt: 0 })
  seedState(state, undefined, cacheOf('/api/x', { n: 1 }, 1234))
  expect(state).toEqual({ data: undefined, loading: true, error: '', fetchedAt: 0 })
})

test('loadState: applies a fresh payload and its stamp', async () => {
  const state = blank<number>()
  state.error = ''
  const run = loadState(state, {
    fetch: () => Promise.resolve(5),
    current: () => true,
    stamp: () => 77,
  })
  expect(state.loading).toBe(true)
  expect(await run).toBe(true)
  expect(state).toEqual({ data: 5, loading: false, error: '', fetchedAt: 77 })
})

test('loadState: revalidating over a seed never shows the loading state', async () => {
  const state: ResourceState<number> = { data: 1, loading: false, error: '', fetchedAt: 10 }
  const run = loadState(state, {
    fetch: () => Promise.resolve(2),
    current: () => true,
    stamp: () => 20,
  })
  expect(state.loading).toBe(false)
  await run
  expect(state.data).toBe(2)
})

test('loadState: a failure keeps the data, sets the error and does not throw', async () => {
  const state: ResourceState<number> = { data: 1, loading: false, error: '', fetchedAt: 10 }
  const fail = () => Promise.reject(new Error('boom'))
  expect(await loadState(state, { fetch: fail, current: () => true, stamp: () => 20 })).toBe(false)
  expect(state).toEqual({ data: 1, loading: false, error: 'boom', fetchedAt: 10 })
})

test('loadState: a failure without a message uses the fallback', async () => {
  const state = blank<number>()
  const fail = () => Promise.reject(new Error(''))
  await loadState(state, { fetch: fail, current: () => true, stamp: () => 1, fallback: 'nope' })
  expect(state.error).toBe('nope')
  expect(state.loading).toBe(false)
})

test('loadState: a success leaves an error the screen wrote alone', async () => {
  const state: ResourceState<number> = { data: 1, loading: false, error: 'locked', fetchedAt: 1 }
  await loadState(state, { fetch: () => Promise.resolve(2), current: () => true, stamp: () => 2 })
  expect(state.error).toBe('locked')
})

test('loadState: an older response never overwrites a newer one', async () => {
  const state = blank<string>()
  state.error = ''
  const seq = sequence()
  const slow = deferred<string>()
  const fast = deferred<string>()
  const start = (source: Promise<string>, at: number) => {
    const ticket = seq.next()
    return loadState(state, {
      fetch: () => source,
      current: () => seq.isLatest(ticket),
      stamp: () => at,
    })
  }
  const first = start(slow.promise, 1)
  const second = start(fast.promise, 2)
  fast.resolve('new')
  expect(await second).toBe(true)
  slow.resolve('old')
  expect(await first).toBe(false)
  expect(state).toEqual({ data: 'new', loading: false, error: '', fetchedAt: 2 })
})

test('loadState: a superseded failure is ignored too', async () => {
  const state = blank<string>()
  state.error = ''
  const seq = sequence()
  const slow = deferred<string>()
  const stale = seq.next()
  const first = loadState(state, {
    fetch: () => slow.promise,
    current: () => seq.isLatest(stale),
    stamp: () => 1,
  })
  seq.next()
  slow.reject(new Error('late'))
  expect(await first).toBe(false)
  expect(state.error).toBe('')
})

test('loadOrThrow: applies the payload and resolves with it', async () => {
  const state = blank<number>()
  const run = loadOrThrow(state, {
    fetch: () => Promise.resolve(5),
    current: () => true,
    stamp: () => 77,
  })
  expect(state.loading).toBe(true)
  expect(await run).toBe(5)
  expect(state).toEqual({ data: 5, loading: false, error: 'old', fetchedAt: 77 })
})

test('loadOrThrow: a failure rejects with the same error and never writes `error`', async () => {
  const state: ResourceState<number> = { data: 1, loading: false, error: '', fetchedAt: 10 }
  const boom = new Error('boom')
  const run = loadOrThrow(state, {
    fetch: () => Promise.reject(boom),
    current: () => true,
    stamp: () => 20,
    fallback: 'unused',
  })
  expect(await run.catch((e: unknown) => e)).toBe(boom)
  expect(state).toEqual({ data: 1, loading: false, error: '', fetchedAt: 10 })
})

test('loadOrThrow: a failure with nothing to show ends the loading state', async () => {
  const state = blank<number>()
  state.error = ''
  const fail = () => Promise.reject(new Error('down'))
  const run = loadOrThrow(state, { fetch: fail, current: () => true, stamp: () => 1 })
  expect(state.loading).toBe(true)
  await run.catch(() => {})
  expect(state).toEqual({ data: undefined, loading: false, error: '', fetchedAt: 9 })
})

test('loadOrThrow: a superseded request answers its caller but leaves the state', async () => {
  const state: ResourceState<string> = { data: 'set', loading: false, error: '', fetchedAt: 3 }
  const seq = sequence()
  const slow = deferred<string>()
  const late = deferred<string>()
  const start = (source: Promise<string>) => {
    const ticket = seq.next()
    const req = { fetch: () => source, current: () => seq.isLatest(ticket), stamp: () => 99 }
    return loadOrThrow(state, req)
  }
  const first = start(slow.promise)
  const second = start(late.promise)
  seq.next()
  slow.resolve('old')
  expect(await first).toBe('old')
  late.reject(new Error('late'))
  expect(((await second.catch((e: unknown) => e)) as Error).message).toBe('late')
  expect(state).toEqual({ data: 'set', loading: false, error: '', fetchedAt: 3 })
})
