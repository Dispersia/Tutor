import { expect, test } from 'bun:test'
import { levelInfo, xpForLevel } from './levels'

test('level curve: each level costs a bit more', () => {
  expect(xpForLevel(1)).toBe(100)
  expect(xpForLevel(2)).toBe(150)
  expect(xpForLevel(3)).toBe(200)
})

test('levelInfo walks the curve', () => {
  expect(levelInfo(0)).toMatchObject({ level: 1, intoLevel: 0, forNext: 100, progress: 0 })
  expect(levelInfo(50)).toMatchObject({ level: 1, intoLevel: 50, forNext: 100 })
  expect(levelInfo(100)).toMatchObject({ level: 2, intoLevel: 0, forNext: 150 })
  expect(levelInfo(250)).toMatchObject({ level: 3, intoLevel: 0, forNext: 200 }) // 100 + 150
  expect(levelInfo(300)).toMatchObject({ level: 3, intoLevel: 50 })
  expect(levelInfo(50).progress).toBeCloseTo(0.5)
})
