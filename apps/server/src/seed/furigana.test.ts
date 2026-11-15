import { expect, test } from 'bun:test'
import { FREQUENCY_JA } from './frequency-ja'
import { furiganaSegments } from './furigana'

const render = (word: string, reading: string) =>
  furiganaSegments(word, reading)
    .map((s) => (s.ruby ? `${s.base}[${s.ruby}]` : s.base))
    .join('')

test('splits kanji from okurigana', () => {
  expect(render('食べる', 'たべる')).toBe('食[た]べる')
  expect(render('大きい', 'おおきい')).toBe('大[おお]きい')
  expect(render('お茶', 'おちゃ')).toBe('お茶[ちゃ]')
  expect(render('先生', 'せんせい')).toBe('先生[せんせい]')
  expect(render('行く', 'いく')).toBe('行[い]く')
})

test('kana-only words have no ruby', () => {
  expect(furiganaSegments('こんにちは', 'こんにちは')).toEqual([{ base: 'こんにちは' }])
  expect(furiganaSegments('あなた', 'あなた')).toEqual([{ base: 'あなた' }])
})

test('every Japanese frequency word produces furigana that covers the word', () => {
  for (const w of FREQUENCY_JA) {
    const segments = furiganaSegments(w.word, w.kana)
    const joined = segments.map((s) => s.base).join('')
    expect(joined).toBe(w.word)
  }
})
