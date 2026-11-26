import { describe, expect, test } from 'bun:test'
import { hangul } from './hangul'
import { BACKSPACE, SPACE, type ImeEngine, type ImeState } from './types'

function type(engine: ImeEngine, keys: string): ImeState {
  return [...keys].reduce((state, key) => engine.press(state, key), engine.initial())
}

describe('hangul', () => {
  test('composes a syllable from jamo', () => {
    expect(type(hangul, 'ㄱㅏㄴ').preedit).toBe('간')
  })

  test('a vowel after a final moves the final into the next syllable', () => {
    const state = type(hangul, 'ㄱㅏㄴㅏ')
    expect(state.value).toBe('가')
    expect(state.preedit).toBe('나')
  })

  test('two consonants do not share a syllable without a vowel', () => {
    const state = type(hangul, 'ㄱㄴ')
    expect(state.value).toBe('ㄱ')
    expect(state.preedit).toBe('ㄴ')
  })

  test('compound vowels and finals compose', () => {
    expect(type(hangul, 'ㄱㅗㅏ').preedit).toBe('과')
    expect(type(hangul, 'ㄷㅏㄹㄱ').preedit).toBe('닭')
    expect(type(hangul, 'ㄱㅏㅂㅅ').preedit).toBe('값')
  })

  test('double consonants compose', () => {
    expect(type(hangul, 'ㄲㅏ').preedit).toBe('까')
    expect(type(hangul, 'ㅆㅏ').preedit).toBe('싸')
  })

  test('a compound final splits when a vowel follows', () => {
    const state = type(hangul, 'ㄷㅏㄹㄱㅏ')
    expect(state.value).toBe('달')
    expect(state.preedit).toBe('가')
  })

  test('space commits the syllable', () => {
    const state = type(hangul, 'ㅎㅏㄴ' + SPACE)
    expect(state.value).toBe('한 ')
    expect(state.preedit).toBe('')
  })

  test('backspace removes the final consonant, then the vowel', () => {
    const noFinal = hangul.press(type(hangul, 'ㄱㅏㄴ'), BACKSPACE)
    expect(noFinal.preedit).toBe('가')
    expect(hangul.press(noFinal, BACKSPACE).preedit).toBe('ㄱ')
  })

  test('backspace past the preedit reopens the committed syllable', () => {
    const state = type(hangul, 'ㄱㅏㄴ' + SPACE + BACKSPACE + BACKSPACE)
    expect(state.value).toBe('')
    expect(state.preedit).toBe('가')
  })

  test('a physical keyboard maps qwerty to 2-beolsik jamo', () => {
    expect(hangul.physical?.q).toBe('ㅂ')
    expect(hangul.physical?.k).toBe('ㅏ')
    expect(hangul.shift?.['ㅂ']).toBe('ㅃ')
  })

  test('punctuation commits the syllable and appends', () => {
    expect(type(hangul, 'ㄱㅏ.').value).toBe('가.')
  })

  test('the symbols page leads with the number row', () => {
    expect(hangul.symbols?.[0]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect(hangul.letters).toBe('한글')
  })
})
