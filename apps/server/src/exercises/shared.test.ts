import { expect, test } from 'bun:test'
import { langName } from '../llm/prompts'
import { label } from './shared'

test('label is langName: one language table, every language it covers', () => {
  for (const code of ['zh', 'yue', 'ja', 'ko', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'xx']) {
    expect(label(code)).toBe(langName(code))
  }
  // The old exercise table stopped at German and showed these as bare codes.
  expect(label('it')).toBe('Italian')
  expect(label('pt')).toBe('Portuguese')
  expect(label('ru')).toBe('Russian')
  expect(label('xx')).toBe('xx')
})
