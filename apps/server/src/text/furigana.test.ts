import { expect, test } from 'bun:test'
import { FREQUENCY_JA } from './frequency-ja'
import { furiganaSegments, furiganaWords } from './furigana'

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

test('splits sentences, keeping ruby on the kanji only', () => {
  expect(render('これは人ですか。', 'これはひとですか')).toBe('これは人[ひと]ですか。')
  expect(render('私は学生です', 'わたしはがくせいです')).toBe('私[わたし]は学生[がくせい]です')
  expect(render('今日は', 'きょうは')).toBe('今日[きょう]は')
  expect(render('食べ物', 'たべもの')).toBe('食[た]べ物[もの]')
})

test('words take their ruby from the per-word readings, not a joined sentence', () => {
  const readings: Record<string, string> = {
    これ: 'これ',
    は: 'は',
    私: 'わたし',
    何: 'なに',
    です: 'です',
    か: 'か',
  }
  const tokens = ['これ', 'は', '私', '何', 'です', 'か']
  const segments = furiganaWords('これは私何ですか。', tokens, (w) => readings[w])
  const rendered = segments.map((s) => (s.ruby ? `${s.base}[${s.ruby}]` : s.base)).join('')
  expect(rendered).toBe('これは私[わたし]何[なに]ですか。')
})

test('a word the readings do not cover gets no ruby', () => {
  expect(furiganaWords('漢字です', ['漢字', 'です'], () => undefined)).toEqual([
    { base: '漢字' },
    { base: 'です' },
  ])
})

test('every Japanese frequency word produces furigana that covers the word', () => {
  for (const w of FREQUENCY_JA) {
    const segments = furiganaSegments(w.word, w.kana)
    const joined = segments.map((s) => s.base).join('')
    expect(joined).toBe(w.word)
  }
})
