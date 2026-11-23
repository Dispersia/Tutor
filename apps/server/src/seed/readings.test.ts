import { expect, test } from 'bun:test'
import { readingsFor } from './service'

test('readingsFor stores Zhuyin for Mandarin and kana for Japanese', () => {
  expect(readingsFor('zh', 'nǐ hǎo')).toEqual({ zhuyin: 'ㄋㄧˇ ㄏㄠˇ' })
  expect(readingsFor('ja', 'taberu', 'たべる')).toEqual({ kana: 'たべる' })
  expect(readingsFor('ja', 'taberu')).toEqual({ kana: 'taberu' })
})

test('readingsFor stores nothing rather than an empty or unreadable reading', () => {
  // These used to come back as `{ zhuyin: '' }` and as Zhuyin with `?` marks in it.
  expect(readingsFor('zh', '')).toEqual({})
  expect(readingsFor('ja', '', '')).toEqual({})
  expect(readingsFor('zh', 'ni3 hao3')).toEqual({})
  expect(readingsFor('zh', 'Nǐ hǎo!')).toEqual({ zhuyin: 'ㄋㄧˇ ㄏㄠˇ' })
})
