import { expect, test } from 'bun:test'
import { accentFor, kanjiumContour, splitMorae } from './kanjium'

test('splitMorae binds small kana to the preceding mora', () => {
  expect(splitMorae('きょう')).toEqual(['きょ', 'う'])
  expect(splitMorae('がっこう')).toEqual(['が', 'っ', 'こ', 'う'])
  expect(splitMorae('しんぶん')).toEqual(['し', 'ん', 'ぶ', 'ん'])
})

test('the dictionary resolves a word by spelling + reading', () => {
  // 毎日 is 頭高 [1]: the model guessed heiban, the dictionary does not.
  expect(kanjiumContour('毎日', 'まいにち')).toEqual({
    levels: ['H', 'L', 'L', 'L'],
    drop: 1,
    syllables: ['ま', 'い', 'に', 'ち'],
  })
  // 勉強 [0] heiban; morae come from the reading, not the model (きょ is one mora).
  expect(kanjiumContour('勉強', 'べんきょう')).toEqual({
    levels: ['L', 'H', 'H', 'H'],
    drop: 0,
    syllables: ['べ', 'ん', 'きょ', 'う'],
  })
  // 好き is odaka [2] — levels derived from the accent number, so they agree.
  expect(kanjiumContour('好き', 'すき')).toEqual({
    levels: ['L', 'H'],
    drop: 2,
    syllables: ['す', 'き'],
  })
  expect(accentFor('人', 'ひと')).toBe(0)
})

test('a kana-only word resolves through its kana headword', () => {
  expect(kanjiumContour('これ', 'これ')).toEqual({
    levels: ['H', 'L'],
    drop: 1,
    syllables: ['こ', 'れ'],
  })
})

test('a kana word with no kana headword is left unresolved', () => {
  // あれ is absent from the source; its reading would otherwise match 荒れ [0].
  expect(accentFor('あれ', 'あれ')).toBeUndefined()
  expect(accentFor('あなた', 'あなた')).toBeUndefined()
})

test('unknown input yields no contour', () => {
  expect(kanjiumContour('ゆうぐれ', '')).toBeUndefined()
  expect(kanjiumContour('zzz', 'zzz')).toBeUndefined()
})
