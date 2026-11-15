import { expect, test } from 'bun:test'
import { STARTER_DECKS } from './decks'
import { FREQUENCY } from './frequency'
import { pinyinToZhuyin } from './zhuyin'

test('converts common syllables and tones', () => {
  expect(pinyinToZhuyin('wǒ')).toBe('ㄨㄛˇ')
  expect(pinyinToZhuyin('nǐ')).toBe('ㄋㄧˇ')
  expect(pinyinToZhuyin('hǎo')).toBe('ㄏㄠˇ')
  expect(pinyinToZhuyin('shì')).toBe('ㄕˋ')
  expect(pinyinToZhuyin('de')).toBe('˙ㄉㄜ')
  expect(pinyinToZhuyin('zhī')).toBe('ㄓ')
  expect(pinyinToZhuyin('xué')).toBe('ㄒㄩㄝˊ')
})

test('handles multi-syllable words, capitals, and erhua', () => {
  expect(pinyinToZhuyin('Zhōngguó')).toBe('ㄓㄨㄥ ㄍㄨㄛˊ')
  expect(pinyinToZhuyin('Hànyǔ')).toBe('ㄏㄢˋ ㄩˇ')
  expect(pinyinToZhuyin('nǐ hǎo')).toBe('ㄋㄧˇ ㄏㄠˇ')
  expect(pinyinToZhuyin("nǚ'ér")).toBe('ㄋㄩˇ ㄦˊ')
  expect(pinyinToZhuyin('nǎr')).toBe('ㄋㄚˇ ㄦ')
})

test('every seed reading converts cleanly (no latin letters left)', () => {
  const hsk = STARTER_DECKS.find((d) => d.targetLang === 'zh')!
  const readings = [...FREQUENCY.map((w) => w.pinyin), ...hsk.cards.map((c) => c.reading)]
  for (const pinyin of readings) {
    const zhuyin = pinyinToZhuyin(pinyin)
    expect(zhuyin.length).toBeGreaterThan(0)
    expect(/[a-z]/i.test(zhuyin)).toBe(false)
    expect(zhuyin).not.toContain('?')
  }
})
