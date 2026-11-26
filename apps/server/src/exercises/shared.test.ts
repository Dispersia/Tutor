import { expect, test } from 'bun:test'
import { langName } from '../llm/prompts'
import { label, promptEndsAtBlank } from './shared'

test('label is langName: one language table, every language it covers', () => {
  for (const code of ['zh', 'yue', 'ja', 'ko', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'xx']) {
    expect(label(code)).toBe(langName(code))
  }
  expect(label('it')).toBe('Italian')
  expect(label('pt')).toBe('Portuguese')
  expect(label('ru')).toBe('Russian')
  expect(label('xx')).toBe('xx')
})

test('promptEndsAtBlank flags only a bare stub before a trailing blank', () => {
  expect(promptEndsAtBlank('我___')).toBe(true)
  expect(promptEndsAtBlank('車___。')).toBe(true)
  expect(promptEndsAtBlank('我___茶。')).toBe(false)
  expect(promptEndsAtBlank('___書。')).toBe(false)
  expect(promptEndsAtBlank('我很___。')).toBe(false)
  expect(promptEndsAtBlank('待___ます')).toBe(false)
  expect(promptEndsAtBlank('這是我___帽子。')).toBe(false)
  expect(promptEndsAtBlank('no blank here')).toBe(false)
})
