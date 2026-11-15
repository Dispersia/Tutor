import { expect, test } from 'bun:test'
import { drainSentences, splitSentences } from './chat'

test('splitSentences chunks a finished reply', () => {
  expect(splitSentences('Hi there. How are you? 好！')).toEqual([
    'Hi there.',
    'How are you?',
    '好！',
  ])
})

test('drainSentences only emits complete sentences and keeps the tail', () => {
  const first = drainSentences('你好。我很')
  expect(first.sentences).toEqual(['你好。'])
  expect(first.rest).toBe('我很')
})

test('drainSentences carries the tail into the next delta', () => {
  let buf = '你好。我很'
  const out: string[] = []
  for (const delta of ['高兴', '认识你！', ' 再见']) {
    buf += delta
    const { sentences, rest } = drainSentences(buf)
    out.push(...sentences)
    buf = rest
  }
  expect(out).toEqual(['你好。', '我很高兴认识你！'])
  expect(buf).toBe(' 再见')
})

test('drainSentences treats newlines as boundaries and trims', () => {
  const { sentences, rest } = drainSentences('line one\nline two\npartial')
  expect(sentences).toEqual(['line one', 'line two'])
  expect(rest).toBe('partial')
})

test('drainSentences ignores empty chunks', () => {
  expect(drainSentences('\n \n')).toEqual({ sentences: [], rest: '' })
})
