import { expect, test } from 'bun:test'
import { FREQUENCY } from './lexicon'
import { displayReading, readingKey, storedReadings, withReading } from './readings'
import { pinyinToZhuyin } from './zhuyin'

test('readingKey: one key per language and script', () => {
  expect(readingKey('ja', 'たべる')).toBe('kana')
  expect(readingKey('ja', 'taberu', 'romaji')).toBe('kana')
  expect(readingKey('zh', 'ㄋㄧˇ')).toBe('zhuyin')
  expect(readingKey('zh', 'nǐ')).toBe('zhuyin')
  expect(readingKey('zh', 'nǐ', 'pinyin')).toBe('pinyin')
  expect(readingKey('yue', 'ㄋㄟˇ')).toBe('zhuyin')
  expect(readingKey('yue', 'nei5')).toBe('reading')
  expect(readingKey('yue', 'nei5', 'pinyin')).toBe('pinyin')
  expect(readingKey('ko', 'annyeong')).toBe('reading')
})

test('storedReadings: a Mandarin Latin reading becomes Zhuyin or nothing', () => {
  expect(storedReadings({ targetLang: 'zh', reading: 'Nǐ hǎo!' })).toEqual({
    zhuyin: 'ㄋㄧˇ ㄏㄠˇ',
  })
  expect(storedReadings({ targetLang: 'zh', reading: 'ni3 hao3' })).toEqual({})
  const fallbackZhuyin = () => 'ㄋㄧˇ ㄏㄠˇ'
  expect(storedReadings({ targetLang: 'zh', reading: 'ni3 hao3', fallbackZhuyin })).toEqual({
    zhuyin: 'ㄋㄧˇ ㄏㄠˇ',
  })
  expect(storedReadings({ targetLang: 'zh', reading: 'nǐ', script: 'pinyin' })).toEqual({
    pinyin: 'nǐ',
  })
})

test('storedReadings: other languages keep the reading as written', () => {
  expect(storedReadings({ targetLang: 'ja', reading: 'たべる' })).toEqual({ kana: 'たべる' })
  expect(storedReadings({ targetLang: 'yue', reading: 'nei5 hou2' })).toEqual({
    reading: 'nei5 hou2',
  })
  expect(storedReadings({ targetLang: 'ko', reading: 'annyeong' })).toEqual({ reading: 'annyeong' })
  expect(storedReadings({ targetLang: 'ja', reading: '' })).toEqual({})
  expect(storedReadings({ targetLang: 'zh', reading: undefined })).toEqual({})
})

test('storedReadings agrees with the plain converter on the whole lexicon', () => {
  for (const w of FREQUENCY) {
    expect(storedReadings({ targetLang: 'zh', reading: w.pinyin })).toEqual({
      zhuyin: pinyinToZhuyin(w.pinyin),
    })
  }
})

test('withReading replaces the reading under the right key', () => {
  expect(withReading({ zhuyin: 'ㄏㄠˇ' }, { targetLang: 'zh', reading: 'nǐ hǎo' })).toEqual({
    zhuyin: 'ㄋㄧˇ ㄏㄠˇ',
  })
  const pinyin = { targetLang: 'zh', reading: 'nǐ hǎo', script: 'pinyin' }
  expect(withReading({ pinyin: 'hǎo' }, pinyin)).toEqual({ pinyin: 'nǐ hǎo' })
  expect(withReading({ reading: 'nei5' }, { targetLang: 'yue', reading: 'ㄋㄟˇ' })).toEqual({
    zhuyin: 'ㄋㄟˇ',
  })
  expect(withReading({ kana: 'た', other: 'x' }, { targetLang: 'ja', reading: 'たべる' })).toEqual({
    kana: 'たべる',
    other: 'x',
  })
})

test('withReading: empty clears, undefined leaves alone', () => {
  expect(withReading({ kana: 'た' }, { targetLang: 'ja', reading: '' })).toEqual({})
  expect(withReading({ kana: 'た' }, { targetLang: 'ja', reading: undefined })).toEqual({
    kana: 'た',
  })
  expect(withReading({ reading: 'x' }, { targetLang: 'ko', reading: 'y' })).toEqual({
    reading: 'y',
  })
})

test('displayReading: kana, Zhuyin (pinyin converted), else the first reading', () => {
  expect(displayReading({ targetLang: 'ja', readings: { kana: 'たべる', romaji: 'taberu' } })).toBe(
    'たべる',
  )
  expect(displayReading({ targetLang: 'ja', readings: { romaji: 'taberu' } })).toBe('')
  expect(displayReading({ targetLang: 'zh', readings: { zhuyin: 'ㄋㄧˇ', pinyin: 'nǐ' } })).toBe(
    'ㄋㄧˇ',
  )
  expect(displayReading({ targetLang: 'zh', readings: { pinyin: 'nǐ hǎo' } })).toBe('ㄋㄧˇ ㄏㄠˇ')
  expect(displayReading({ targetLang: 'yue', readings: { reading: 'nei5' } })).toBe('nei5')
  expect(displayReading({ targetLang: 'ko', readings: { reading: '', x: 'an' } })).toBe('an')
  expect(displayReading({ targetLang: 'ko', readings: {} })).toBe('')
})
