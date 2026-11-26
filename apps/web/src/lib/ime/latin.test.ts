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
})
