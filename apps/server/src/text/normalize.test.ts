import { expect, test } from 'bun:test'
import {
  answerKey,
  bareText,
  lettersAndDigits,
  sentenceKey,
  tonelessKey,
  wordKey,
} from './normalize'

test('tonelessKey strips case, tone marks, punctuation, spaces', () => {
  expect(tonelessKey('Nǐ hǎo!')).toBe('nihao')
  expect(tonelessKey(' 你好。')).toBe('你好')
  expect(tonelessKey('Kon-nichiwa')).toBe('konnichiwa')
})

test('answerKey keeps the diacritics tonelessKey folds', () => {
  expect(answerKey('Año, ')).toBe('año')
  expect(tonelessKey('Año, ')).toBe('ano')
  expect(answerKey('が')).not.toBe(answerKey('か'))
  expect(answerKey('(Ｎｉ\u3000hao)…')).toBe('nihao')
})

test('bareText drops spaces, punctuation and symbols but folds nothing', () => {
  expect(bareText('你好。')).toBe('你好')
  expect(bareText(' Wǒ – hěn「好」+ $1 ')).toBe('wǒhěn好1')
  expect(bareText('ＡＢＣ')).toBe('ａｂｃ')
})

test('wordKey is bareText with width folded', () => {
  expect(wordKey('ＡＢＣ\u3000ｶﾞ!')).toBe('abcガ')
  expect(wordKey('Café')).toBe(bareText('Café'))
})

test('lettersAndDigits keeps only letters and digits', () => {
  expect(lettersAndDigits('Ｈｅｌｌｏ, wörld 42!')).toBe('hellowörld42')
  // NFKC composes an accent where it can; a mark with no composed form is dropped.
  expect(lettersAndDigits('e\u0301')).toBe('é')
  expect(lettersAndDigits('x\u20dd1')).toBe('x1')
  expect(wordKey('x\u20dd1')).toBe('x\u20dd1')
})

test('sentenceKey ignores spacing and sentence punctuation, not case', () => {
  expect(sentenceKey(' 我 很 好。')).toBe('我很好')
  expect(sentenceKey("I'm fine, thanks!")).toBe('Imfinethanks')
  expect(sentenceKey('Hello')).not.toBe(sentenceKey('hello'))
  expect(sentenceKey('a-b')).toBe('a-b')
})
