import { expect, test } from 'bun:test'
import {
  defaultFetcher,
  fetchFrequencyWords,
  frequencySourceFor,
  parseFrequencyList,
} from './source'

const SAMPLE = `的 3957141
我 3669472
你 3282942
、 148670
。 104416
， 90000
好 558010
我 3669472
12345 500
ok 42
`

test('parseFrequencyList ranks words, drops punctuation and de-dupes', () => {
  const words = parseFrequencyList(SAMPLE)
  expect(words.map((w) => w.word)).toEqual(['的', '我', '你', '好', 'ok'])
  expect(words[0]).toEqual({ word: '的', rank: 1, count: 3957141 })
  expect(words[1]!.rank).toBe(2)
})

test('parseFrequencyList honours the limit', () => {
  expect(parseFrequencyList(SAMPLE, 2).map((w) => w.word)).toEqual(['的', '我'])
})

test('frequencySourceFor maps languages to real list URLs', () => {
  expect(frequencySourceFor('zh')?.url).toContain('/zh_tw/zh_tw_50k.txt')
  expect(frequencySourceFor('zh', 'simplified')?.url).toContain('/zh_cn/zh_cn_50k.txt')
  expect(frequencySourceFor('ja')?.url).toContain('/ja/ja_full.txt')
  expect(frequencySourceFor('es')?.url).toContain('/es/es_50k.txt')
  expect(frequencySourceFor('!!')).toBeUndefined()
})

test('fetchFrequencyWords pulls through the injected fetcher (no network)', async () => {
  let called = ''
  const { source, words } = await fetchFrequencyWords('zh', {
    fetcher: async (url) => {
      called = url
      return SAMPLE
    },
  })
  expect(called).toBe(source.url)
  expect(source.label).toContain('Traditional')
  expect(words.length).toBeGreaterThan(0)
})

test('fetchFrequencyWords errors when there is no list for the language', async () => {
  await expect(fetchFrequencyWords('zz-zz')).rejects.toThrow(/no frequency list/)
})

test('the default fetcher downloads a list once, with a timeout, and retries a failure', async () => {
  const orig = globalThis.fetch
  let calls = 0
  let fail = true
  const signals: (AbortSignal | null | undefined)[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls++
    signals.push(init?.signal)
    return fail ? new Response('nope', { status: 503 }) : new Response('的 100\n我 90')
  }) as unknown as typeof fetch
  try {
    const url = 'http://frequency.test/once.txt'
    await expect(defaultFetcher(url)).rejects.toThrow(/-> 503/)
    fail = false
    expect(await defaultFetcher(url)).toBe('的 100\n我 90')
    expect(await defaultFetcher(url)).toBe('的 100\n我 90')
    expect(calls).toBe(2)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    await defaultFetcher('http://frequency.test/other.txt')
    expect(calls).toBe(3)
  } finally {
    globalThis.fetch = orig
  }
})
