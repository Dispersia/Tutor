import { expect, test } from 'bun:test'
import { FREQUENCY, LEXICON } from '../text/lexicon'
import { SENTENCE_POS, buildSentence, canBuildSentence } from './grammar'

const first = (known: string[], word: string) => {
  const entry = LEXICON.get(word)!
  return buildSentence(entry, new Set(known), () => 0)
}

test('builds a copula sentence from known words', () => {
  const b = first(['我', '是', '老師'], '學生')
  expect(b?.tokens).toEqual(['我', '是', '學生'])
  expect(b?.gloss).toBe('I am a student.')
  expect(b?.reading).toBe('wǒ shì xuésheng')
})

test('builds an SVO sentence and a 嗎 question', () => {
  expect(first(['我', '茶'], '喝')?.tokens).toEqual(['我', '喝', '茶'])
  expect(first(['我', '你', '喝', '茶'], '嗎')?.tokens).toEqual(['你', '喝', '茶', '嗎'])
})

test('nothing to build without prior knowledge', () => {
  expect(buildSentence(LEXICON.get('喝')!, new Set(), () => 0)).toBeUndefined()
  expect(canBuildSentence(LEXICON.get('喝')!, new Set())).toBe(false)
})

test('every generated sentence is n+1: only the new word is unknown', () => {
  const known = new Set<string>()
  let built = 0
  for (const w of FREQUENCY) {
    const b = buildSentence(w, known, () => 0)
    if (b) {
      built++
      expect(b.tokens).toContain(w.word)
      for (const t of b.tokens) {
        if (t !== w.word) expect(known.has(t)).toBe(true)
        expect(LEXICON.has(t)).toBe(true)
      }
      expect(b.gloss.length).toBeGreaterThan(0)
      expect(b.bank.length).toBeGreaterThanOrEqual(b.tokens.length)
      expect(b.tokens.length).toBeGreaterThanOrEqual(2)
    }
    known.add(w.word)
  }
  expect(built).toBeGreaterThan(40)
})

test('sentence_build is only offered for featureable parts of speech', () => {
  for (const w of FREQUENCY) {
    if (['num', 'measure', 'qword', 'greet'].includes(w.pos)) {
      expect(SENTENCE_POS.has(w.pos)).toBe(false)
    }
  }
})
