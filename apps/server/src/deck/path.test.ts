import { expect, test } from 'bun:test'
import { isPath, orderPathWords, pathDeckName, pathInstruction, pathSeedWords } from './path'

test('a path deck is recognised by its kind', () => {
  expect(isPath('path')).toBe(true)
  expect(isPath('custom')).toBe(false)
  expect(isPath(undefined)).toBe(false)
})

test('a path deck is named after its language', () => {
  expect(pathDeckName('zh')).toBe('Mandarin · Path')
  expect(pathDeckName('ko')).toBe('Korean · Path')
})

test('the path instruction asks for everyday language, sentences and grammar', () => {
  const text = pathInstruction('ja')
  expect(text).toContain('Japanese')
  expect(text).toContain('manga')
  expect(text.toLowerCase()).toContain('sentence')
  expect(text.toLowerCase()).toContain('grammar')
  expect(text.toLowerCase()).toContain('everyday')
})

test('the sentence-first seeds cover Chinese and Japanese, and no others', () => {
  expect(pathSeedWords('zh').length).toBeGreaterThan(100)
  expect(pathSeedWords('ja').length).toBeGreaterThan(100)
  expect(pathSeedWords('zh', 'simplified')).toEqual([])
  expect(pathSeedWords('es')).toEqual([])
})

test('the Korean path starts from words a sentence can be built from', () => {
  const seed = pathSeedWords('ko')
  expect(seed.slice(0, 4)).toEqual(['저', '학생', '이에요', '는'])
  expect(new Set(seed).size).toBe(seed.length)
})

test('the Japanese path teaches the copula and particles before they are needed', () => {
  const seed = pathSeedWords('ja')
  expect(seed[0]).toBe('私')
  expect(seed.slice(0, 6)).toContain('です')
  expect(seed.slice(0, 6)).toContain('は')
  expect(new Set(seed).size).toBe(seed.length)
})

test('orderPathWords keeps the seed first, drops duplicates, and caps the length', () => {
  expect(orderPathWords(['我', '喝'], ['喝', '茶', '我'])).toEqual(['我', '喝', '茶'])
  expect(orderPathWords([], ['a', 'a', 'b', ''])).toEqual(['a', 'b'])
  const long = orderPathWords(
    [],
    Array.from({ length: 6000 }, (_, i) => `w${i}`),
  )
  expect(long).toHaveLength(5000)
})
