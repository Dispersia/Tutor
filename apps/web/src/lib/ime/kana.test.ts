import { describe, expect, test } from 'bun:test'
import { kana } from './kana'
import { BACKSPACE, SPACE, type ImeEngine, type ImeState } from './types'

function type(engine: ImeEngine, keys: string): ImeState {
  return [...keys].reduce((state, key) => engine.press(state, key), engine.initial())
}

describe('kana', () => {
  test('romaji becomes kana', () => {
    expect(type(kana, 'ka').preedit).toBe('か')
    expect(type(kana, 'shi').preedit).toBe('し')
    expect(type(kana, 'tsu').preedit).toBe('つ')
    expect(type(kana, 'kya').preedit).toBe('きゃ')
  })

  test('a lone n waits, then becomes ん', () => {
    expect(type(kana, 'n').buffer).toBe('n')
    expect(type(kana, 'ni').preedit).toBe('に')
    expect(type(kana, 'kann').preedit).toBe('かん')
    expect(type(kana, 'kanga').preedit).toBe('かんが')
  })

  test('a doubled consonant becomes a small tsu', () => {
    expect(type(kana, 'kka').preedit).toBe('っか')
    expect(type(kana, 'tta').preedit).toBe('った')
  })

  test('an incomplete romaji stays in the buffer', () => {
    const state = type(kana, 'kan')
    expect(state.preedit).toBe('か')
    expect(state.buffer).toBe('n')
  })

  test('space commits and adds a space', () => {
    const state = type(kana, 'ka' + SPACE)
    expect(state.value).toBe('か ')
    expect(state.preedit).toBe('')
  })

  test('finish converts the pending buffer', () => {
    expect(kana.finish(type(kana, 'kann'))).toBe('かん')
  })

  test('backspace removes the pending romaji first', () => {
    expect(type(kana, 'kan' + BACKSPACE).buffer).toBe('')
    expect(type(kana, 'ka' + BACKSPACE).preedit).toBe('')
  })

  test('punctuation commits the kana and appends', () => {
    expect(type(kana, 'ka。').value).toBe('か。')
  })

  test('the symbols page leads with the number row', () => {
    expect(kana.symbols?.[0]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect(kana.letters).toBe('かな')
  })
})
