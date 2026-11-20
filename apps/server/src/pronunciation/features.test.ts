import { expect, test } from 'bun:test'
import { computeFeatures, deterministicWords, summarize, syllableCount, tokenize } from './features'

test('tokenize: CJK per char, latin per word', () => {
  expect(tokenize('你好世界')).toEqual(['你', '好', '世', '界'])
  expect(tokenize('hello world')).toEqual(['hello', 'world'])
  expect(tokenize('你好。 world!')).toEqual(['你', '好', 'world'])
  expect(syllableCount('你')).toBe(1)
  expect(syllableCount('hello')).toBe(2)
})

test('a perfect attempt scores high with no missing tokens', () => {
  const f = computeFeatures({
    expected: '你好',
    transcript: '你好',
    items: [
      { text: '你', start: 0.1, end: 0.35 },
      { text: '好', start: 0.35, end: 0.65 },
    ],
    duration: 1.1,
  })
  expect(f.cer).toBe(0)
  expect(f.missing).toEqual([])
  expect(f.score).toBeGreaterThanOrEqual(90)
  expect(f.correct).toBe(true)
})

test('a missing word is detected and scores lower', () => {
  const full = computeFeatures({
    expected: '你好世界',
    transcript: '你好世界',
    items: [
      { text: '你', start: 0.1, end: 0.3 },
      { text: '好', start: 0.3, end: 0.5 },
      { text: '世', start: 0.5, end: 0.7 },
      { text: '界', start: 0.7, end: 0.9 },
    ],
    duration: 1.4,
  })
  const partial = computeFeatures({
    expected: '你好世界',
    transcript: '你好',
    items: [
      { text: '你', start: 0.1, end: 0.3 },
      { text: '好', start: 0.3, end: 0.5 },
    ],
    duration: 0.6,
  })
  expect(partial.missing.sort()).toEqual(['世', '界'])
  expect(partial.correct).toBe(false)
  expect(partial.score).toBeLessThan(full.score)
  expect(summarize(partial)).toContain('世')
  const words = deterministicWords(partial)
  expect(words.find((w) => w.text === '世')?.ok).toBe(false)
})

test('a wrong word scores lower than the right one', () => {
  const right = computeFeatures({
    expected: '你好',
    transcript: '你好',
    items: [
      { text: '你', start: 0.1, end: 0.35 },
      { text: '好', start: 0.35, end: 0.65 },
    ],
    duration: 1.1,
  })
  const wrong = computeFeatures({
    expected: '你好',
    transcript: '再见',
    items: [
      { text: '你', start: 0.1, end: 0.35 },
      { text: '好', start: 0.35, end: 0.65 },
    ],
    duration: 1.1,
  })
  expect(wrong.cer).toBeGreaterThan(0)
  expect(wrong.score).toBeLessThan(right.score)
})

test('timing anomalies are flagged and pauses reported', () => {
  const f = computeFeatures({
    expected: '妈妈',
    transcript: '妈妈',
    items: [
      { text: '妈', start: 0.0, end: 0.02 }, // clipped
      { text: '妈', start: 1.2, end: 1.6 }, // after a long pause
    ],
    duration: 1.8,
  })
  expect(f.words[0]!.flagged).toBe(true)
  expect(f.pauses.length).toBe(1)
  expect(f.pauses[0]!.after).toBe('妈')
})

test('latin phrases count syllables and differ from CJK handling', () => {
  const f = computeFeatures({
    expected: 'hello world',
    transcript: 'hello world',
    items: [
      { text: 'hello', start: 0.1, end: 0.6 },
      { text: 'world', start: 0.6, end: 1.0 },
    ],
    duration: 1.3,
  })
  expect(f.missing).toEqual([])
  expect(f.correct).toBe(true)
  expect(f.speechRate).toBeGreaterThan(1)
})

test('a Taiwan-accent realisation (sh → s) is not a missing word', () => {
  const f = computeFeatures({
    expected: '是',
    transcript: '四', // Whisper heard the merged s-initial
    items: [{ text: '是', start: 0.1, end: 0.5 }],
    duration: 0.6,
    lang: 'zh',
  })
  expect(f.missing).toEqual([])
  expect(f.cer).toBe(0)
  expect(f.correct).toBe(true)
})

test('accent tolerance is opt-in to Mandarin and still catches other words', () => {
  // Without a language, characters are compared literally (unchanged behaviour).
  const literal = computeFeatures({
    expected: '是',
    transcript: '四',
    items: [{ text: '是', start: 0.1, end: 0.5 }],
    duration: 0.6,
  })
  expect(literal.missing).toEqual(['是'])

  // A genuinely different word is still missing even with tolerance on.
  const wrong = computeFeatures({
    expected: '是',
    transcript: '你好',
    items: [{ text: '是', start: 0.1, end: 0.5 }],
    duration: 0.6,
    lang: 'zh',
  })
  expect(wrong.missing).toEqual(['是'])
})
