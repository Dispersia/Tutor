import { describe, expect, test } from 'bun:test'
import { latin } from './latin'
import { BACKSPACE, SPACE, type ImeEngine, type ImeState } from './types'

function type(engine: ImeEngine, keys: string): ImeState {
  return [...keys].reduce((state, key) => engine.press(state, key), engine.initial())
}

describe('latin', () => {
  test('letters append straight to the value', () => {
    expect(type(latin, 'hello').value).toBe('hello')
  })

  test('space inserts a space and backspace removes one character', () => {
    expect(type(latin, 'hi' + SPACE).value).toBe('hi ')
    expect(type(latin, 'hi' + BACKSPACE).value).toBe('h')
  })

  test('finish returns the typed text', () => {
    expect(latin.finish(type(latin, 'cat'))).toBe('cat')
  })

  test('punctuation appends to the value', () => {
    expect(type(latin, 'hi!').value).toBe('hi!')
  })

  test('the symbols page leads with the number row', () => {
    expect(latin.symbols?.[0]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect(latin.letters).toBe('ABC')
  })
})
