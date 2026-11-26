import { describe, expect, test } from 'bun:test'
import { imeCandidates } from './candidates'

describe('ime candidates', () => {
  test('a zhuyin reading returns Traditional words', () => {
    expect(imeCandidates('zh', 'ㄋㄧˇ ㄏㄠˇ')).toContain('你好')
    expect(imeCandidates('zh', 'ㄋㄧ')).toContain('你')
  })

  test('tones are optional in the query', () => {
    expect(imeCandidates('zh', 'ㄋㄧ ㄏㄠ')).toContain('你好')
  })

  test('a whole zhuyin sentence converts word by word', () => {
    expect(imeCandidates('zh', 'ㄨㄛˇ ㄏㄣˇ ㄏㄠˇ')[0]).toBe('我很好')
    expect(imeCandidates('zh', 'ㄨㄛˇ ㄕˋ ㄒㄩㄝˊ ㄕㄥ')[0]).toBe('我是學生')
  })

  test('a toneless reading still segments and converts', () => {
    expect(imeCandidates('zh', 'ㄨㄛㄏㄣㄏㄠ')[0]).toBe('我很好')
    expect(imeCandidates('zh', 'ㄋㄧㄏㄠ')[0]).toBe('你好')
    expect(imeCandidates('zh', 'ㄉㄧㄢˋㄋㄠˇ')[0]).toBe('電腦')
  })

  test('kana converts to kanji, particles stay kana', () => {
    expect(imeCandidates('ja', 'かんじ')).toContain('漢字')
    expect(imeCandidates('ja', 'にほんご')[0]).toBe('日本語')
    expect(imeCandidates('ja', 'わたしは')[0]).toBe('私は')
  })

  test('a kana sentence keeps converting after a particle', () => {
    expect(imeCandidates('ja', 'わたしはがくせい')[0]).toBe('私は学生')
  })

  test('an unknown language has no candidates', () => {
    expect(imeCandidates('de', 'hallo')).toEqual([])
  })

  test('an empty query returns nothing', () => {
    expect(imeCandidates('zh', '   ')).toEqual([])
  })
})
