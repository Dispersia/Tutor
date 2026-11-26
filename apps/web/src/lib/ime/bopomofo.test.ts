import { describe, expect, test } from 'bun:test'
import { bopomofo } from './bopomofo'
import { BACKSPACE, SPACE, type ImeEngine, type ImeState } from './types'

function type(engine: ImeEngine, keys: string): ImeState {
  return [...keys].reduce((state, key) => engine.press(state, key), engine.initial())
}

describe('bopomofo', () => {
  test('symbols build a reading with no separator', () => {
    expect(type(bopomofo, 'ㄋㄧ').preedit).toBe('ㄋㄧ')
    expect(type(bopomofo, 'ㄋㄧˇ').preedit).toBe('ㄋㄧˇ')
  })

  test('a whole sentence is typed toneless, in one buffer', () => {
    expect(type(bopomofo, 'ㄨㄛㄏㄣㄏㄠ').preedit).toBe('ㄨㄛㄏㄣㄏㄠ')
    expect(type(bopomofo, 'ㄋㄧˇㄏㄠˇ').preedit).toBe('ㄋㄧˇㄏㄠˇ')
  })

  test('backspace removes one symbol at a time', () => {
    expect(type(bopomofo, 'ㄋㄧˇ' + BACKSPACE).preedit).toBe('ㄋㄧ')
    expect(type(bopomofo, 'ㄋㄧˇ' + BACKSPACE + BACKSPACE).preedit).toBe('ㄋ')
  })

  test('space and enter commit the top candidate', () => {
    const state: ImeState = { ...type(bopomofo, 'ㄨㄛㄏㄣㄏㄠ'), candidates: ['我很好'] }
    expect(bopomofo.press(state, SPACE).value).toBe('我很好')
    expect(bopomofo.press(state, SPACE).preedit).toBe('')
  })

  test('finish falls back to the raw reading when there is no candidate', () => {
    expect(bopomofo.finish(type(bopomofo, 'ㄋㄧˇㄏㄠˇ'))).toBe('ㄋㄧˇㄏㄠˇ')
  })

  test('a chosen candidate is committed instead of the reading', () => {
    const state: ImeState = { ...type(bopomofo, 'ㄋㄧˇㄏㄠˇ'), candidates: ['你好'] }
    expect(bopomofo.finish(state)).toBe('你好')
  })

  test('a physical keyboard maps the standard zhuyin layout', () => {
    expect(bopomofo.physical?.['1']).toBe('ㄅ')
    expect(bopomofo.physical?.q).toBe('ㄆ')
    expect(bopomofo.physical?.a).toBe('ㄇ')
  })
})
