import { expect, test } from 'bun:test'
import {
  CONVERSATION_LANGUAGE_RULE,
  NATIVE_FEEDBACK_REMINDER,
  NATIVE_FEEDBACK_RULE,
  langName,
} from './prompts'

test('native feedback rule names both languages and forbids the target', () => {
  const rule = NATIVE_FEEDBACK_RULE('en', 'zh')
  expect(rule).toContain('English')
  expect(rule).toContain('Mandarin')
  expect(rule).toContain('Never write the feedback in Mandarin')
})

test('native feedback rule still works without a target language', () => {
  const rule = NATIVE_FEEDBACK_RULE('en')
  expect(rule).toContain('English')
  expect(rule).toContain('the language being practised')
})

test('the reminder is a short last-word instruction', () => {
  const line = NATIVE_FEEDBACK_REMINDER('en', 'zh')
  expect(line).toContain('English only')
  expect(line).toContain('never in Mandarin')
})

test('conversation rule keeps the dialogue but explains in the native language', () => {
  const rule = CONVERSATION_LANGUAGE_RULE('en', 'ja')
  expect(rule).toContain('Hold the conversation in Japanese')
  expect(rule).toContain('native language (English)')
  expect(rule).toContain('Never explain in Japanese')
})

test('langName resolves short codes with an English fallback', () => {
  expect(langName('zh')).toBe('Mandarin')
  expect(langName(null)).toBe('English')
})
