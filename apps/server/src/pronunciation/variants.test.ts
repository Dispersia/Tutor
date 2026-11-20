import { expect, test } from 'bun:test'
import { charSound, foldZhuyin, soundAlike } from './variants'

test('foldZhuyin collapses the retroflex series to the Taiwan alveolar series', () => {
  expect(foldZhuyin('ㄕˋ')).toBe('ㄙˋ')
  expect(foldZhuyin('ㄓㄨㄥ')).toBe('ㄗㄨㄥ')
  expect(foldZhuyin('ㄔㄨ')).toBe('ㄘㄨ')
  // Tones survive: the fold never turns a wrong tone into a right one.
  expect(foldZhuyin('ㄕ')).toBe('ㄙ')
  expect(foldZhuyin('ㄕˊ')).toBe('ㄙˊ')
})

test('foldZhuyin also merges n → l, f → h, and -eng/-ing → -en/-in', () => {
  expect(foldZhuyin('ㄋㄧˇ')).toBe('ㄌㄧˇ')
  expect(foldZhuyin('ㄈㄢˋ')).toBe('ㄏㄢˋ')
  expect(foldZhuyin('ㄒㄧㄥ')).toBe('ㄒㄧㄣ')
  expect(foldZhuyin('ㄏㄥ')).toBe('ㄏㄣ')
  // -ong/-iong keep their ㄥ: they do not merge with -un.
  expect(foldZhuyin('ㄓㄨㄥ')).toBe('ㄗㄨㄥ')
})

test('a Taiwan-accent realisation is sound-alike, a genuinely different word is not', () => {
  // 是 (shì) vs 四 (sì): the sh/s merger, so the same sound in Taiwan.
  expect(soundAlike('是', '四')).toBe(true)
  expect(soundAlike('四', '是')).toBe(true)
  // The broader Taiwan mergers.
  expect(soundAlike('你', '里')).toBe(true) // n → l
  expect(soundAlike('星', '心')).toBe(true) // -ing → -in
  expect(soundAlike('飯', '漢')).toBe(true) // f → h
  expect(soundAlike('是', '是')).toBe(true)
  // Genuinely different syllables stay apart.
  expect(soundAlike('是', '你')).toBe(false)
  expect(soundAlike('是', '七')).toBe(false)
  // An unknown character never counts as sound-alike.
  expect(soundAlike('是', 'Z')).toBe(false)
})

test('charSound folds through the bundled Taiwan dictionary', () => {
  expect(charSound('是')).toBe('ㄙˋ')
  expect(charSound('四')).toBe('ㄙˋ')
  expect(charSound('zzz')).toBeUndefined()
})
