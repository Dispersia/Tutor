import { expect, test } from 'bun:test'
import { FREQUENCY } from './lexicon'
import {
  displayReading,
  hasReadingScript,
  kanaFromWords,
  readingKey,
  readingsFor,
  storedReadings,
  withReading,
} from './readings'
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

test('storedReadings: native scripts only, no romanization for any language', () => {
  expect(storedReadings({ targetLang: 'ja', reading: 'たべる' })).toEqual({ kana: 'たべる' })
  expect(storedReadings({ targetLang: 'yue', reading: 'ㄋㄟˇ' })).toEqual({ zhuyin: 'ㄋㄟˇ' })
  expect(storedReadings({ targetLang: 'yue', reading: 'nei5 hou2' })).toEqual({})
  expect(storedReadings({ targetLang: 'ko', reading: 'annyeong' })).toEqual({})
  expect(storedReadings({ targetLang: 'es', reading: 'agua' })).toEqual({})
  expect(storedReadings({ targetLang: 'ja', reading: '' })).toEqual({})
  expect(storedReadings({ targetLang: 'zh', reading: undefined })).toEqual({})
})

test('hasReadingScript: only the scripts the app renders', () => {
  expect(hasReadingScript('zh')).toBe(true)
  expect(hasReadingScript('yue')).toBe(true)
  expect(hasReadingScript('ja')).toBe(true)
  expect(hasReadingScript('ko')).toBe(false)
  expect(hasReadingScript('es')).toBe(false)
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

test('withReading: empty clears, undefined leaves alone, and Korean never keeps one', () => {
  expect(withReading({ kana: 'た' }, { targetLang: 'ja', reading: '' })).toEqual({})
  expect(withReading({ kana: 'た' }, { targetLang: 'ja', reading: undefined })).toEqual({
    kana: 'た',
  })
  expect(withReading({ reading: 'x' }, { targetLang: 'ko', reading: 'y' })).toEqual({})
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
  expect(displayReading({ targetLang: 'yue', readings: { zhuyin: 'ㄋㄟˇ' } })).toBe('ㄋㄟˇ')
  expect(displayReading({ targetLang: 'yue', readings: { reading: 'nei5' } })).toBe('')
  expect(displayReading({ targetLang: 'ko', readings: { reading: '', x: 'an' } })).toBe('')
  expect(displayReading({ targetLang: 'ko', readings: {} })).toBe('')
})

test('readingsFor stores Zhuyin for Mandarin and kana for Japanese', () => {
  expect(readingsFor('zh', 'nǐ hǎo')).toEqual({ zhuyin: 'ㄋㄧˇ ㄏㄠˇ' })
  expect(readingsFor('ja', 'taberu', 'たべる')).toEqual({ kana: 'たべる' })
  expect(readingsFor('ja', 'taberu')).toEqual({ kana: 'taberu' })
})

test('kanaFromWords joins the dictionary reading of every word', () => {
  const readings: Record<string, string> = { 何: 'なに', 食べる: 'たべる' }
  expect(kanaFromWords(['これ', 'は', '何', 'です', 'か'], (w) => readings[w])).toBe(
    'これはなにですか',
  )
  expect(kanaFromWords(['食べる'], (w) => readings[w])).toBe('たべる')
})

test('kanaFromWords gives up when a kanji word has no dictionary reading', () => {
  expect(kanaFromWords(['漢字', 'です'], () => undefined)).toBeUndefined()
})

test('readingsFor stores nothing rather than an empty or unreadable reading', () => {
  expect(readingsFor('zh', '')).toEqual({})
  expect(readingsFor('ja', '', '')).toEqual({})
  expect(readingsFor('zh', 'ni3 hao3')).toEqual({})
  expect(readingsFor('zh', 'Nǐ hǎo!')).toEqual({ zhuyin: 'ㄋㄧˇ ㄏㄠˇ' })
})
