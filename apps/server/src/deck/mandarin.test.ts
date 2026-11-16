import { expect, test } from 'bun:test'
import { mandarinZhuyin } from './mandarin'

test('Taiwan readings come from the dictionary, not the model', () => {
  // every one of these differs from the Mainland reading or the model's guess
  expect(mandarinZhuyin('頭髮')).toBe('ㄊㄡˊ ㄈㄚˇ')
  expect(mandarinZhuyin('星期')).toBe('ㄒㄧㄥ ㄑㄧˊ')
  expect(mandarinZhuyin('垃圾')).toBe('ㄌㄜˋ ㄙㄜˋ')
  expect(mandarinZhuyin('危險')).toBe('ㄨㄟˊ ㄒㄧㄢˇ')
  expect(mandarinZhuyin('什麼')).toBe('ㄕㄣˊ ˙ㄇㄜ')
  expect(mandarinZhuyin('我們')).toBe('ㄨㄛˇ ˙ㄇㄣ')
})

test('single characters use their preferred reading', () => {
  // the ministry lists readings alphabetically, so these come from McBopomofo
  expect(mandarinZhuyin('行')).toBe('ㄒㄧㄥˊ')
  expect(mandarinZhuyin('都')).toBe('ㄉㄡ')
  expect(mandarinZhuyin('會')).toBe('ㄏㄨㄟˋ')
  expect(mandarinZhuyin('的')).toBe('ㄉㄜ˙')
})

test('unknown input yields no reading', () => {
  expect(mandarinZhuyin('')).toBeUndefined()
  expect(mandarinZhuyin('zzz')).toBeUndefined()
})
