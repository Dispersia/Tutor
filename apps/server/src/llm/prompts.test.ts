import { expect, test } from 'bun:test'
import {
  NATIVE_FEEDBACK_REMINDER,
  NATIVE_FEEDBACK_RULE,
  conversationSystem,
  judgeSystem,
  langName,
  scriptRule,
  systemPrompt,
} from './prompts'

test('native feedback rule names both languages', () => {
  const rule = NATIVE_FEEDBACK_RULE('en', 'zh')
  expect(rule).toContain('Write all feedback in English')
  expect(rule).toContain('Mandarin')
})

test('native feedback rule still works without a target language', () => {
  const rule = NATIVE_FEEDBACK_RULE('en')
  expect(rule).toContain('English')
  expect(rule).toContain('the language being practised')
})

test('the reminder is a short last-word instruction', () => {
  expect(NATIVE_FEEDBACK_REMINDER('en', 'zh')).toBe(
    'Write the feedback in English, not in Mandarin.',
  )
  expect(NATIVE_FEEDBACK_REMINDER('en')).toBe('Write the feedback in English.')
})

test('the script rule follows the deck, and says nothing for other languages', () => {
  expect(scriptRule('zh')).toContain('Traditional characters')
  expect(scriptRule('zh')).toContain('Zhuyin')
  const pinyin = scriptRule('zh', { variant: 'simplified', readingScript: 'pinyin' })
  expect(pinyin).toContain('Simplified characters')
  expect(pinyin).toContain('pinyin')
  expect(pinyin).not.toContain('Zhuyin')
  expect(scriptRule('ja')).toContain('kana')
  expect(scriptRule('yue')).not.toContain('Zhuyin')
  expect(scriptRule('es')).toBe('')
})

test('the conversation prompt names both languages and asks for speakable text', () => {
  const prompt = conversationSystem({ nativeLang: 'en', targetLang: 'ja' })
  expect(prompt).toContain('Japanese conversation partner')
  expect(prompt).toContain('native language is English')
  expect(prompt).toContain('text-to-speech')
  expect(prompt).toContain('no markdown')
  expect(prompt).not.toContain('Zhuyin')
  expect(prompt).not.toContain('Traditional')
})

test('a Spanish prompt carries no script rule and no stray blank bullet', () => {
  const prompt = conversationSystem({ nativeLang: 'en', targetLang: 'es' })
  expect(prompt.endsWith('romanization after a word.')).toBe(true)
  expect(judgeSystem({ nativeLang: 'en', targetLang: 'es' })).not.toMatch(/\n-?\s*$/)
})

test('systemPrompt appends the caller’s extra instruction last', () => {
  const [msg] = systemPrompt(
    'conversation',
    { nativeLang: 'en', targetLang: 'zh' },
    'Talk about food.',
  )
  expect(msg!.role).toBe('system')
  expect(msg!.content.endsWith('Talk about food.')).toBe(true)
  const [judge] = systemPrompt('judge', { nativeLang: 'en', targetLang: 'zh' })
  expect(judge!.content).toContain('Write all feedback in English')
})

test('langName resolves short codes with an English fallback', () => {
  expect(langName('zh')).toBe('Mandarin')
  expect(langName(null)).toBe('English')
})
