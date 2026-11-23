import { expect, test } from 'bun:test'
import { htmlLang, typingAttrs } from './lang'

test('htmlLang maps app codes to HTML lang tags', () => {
  expect(htmlLang('ja')).toBe('ja')
  expect(htmlLang('en')).toBe('en')
  expect(htmlLang('zh')).toBe('zh-Hant')
  expect(htmlLang('zh', 'simplified')).toBe('zh-Hans')
  expect(htmlLang('yue')).toBe('zh-Hant-HK')
  expect(htmlLang('')).toBeUndefined()
  expect(htmlLang(undefined)).toBeUndefined()
  expect(htmlLang('pt')).toBe('pt')
})

test('typingAttrs labels a field and turns off wrong-language help', () => {
  const a = typingAttrs('ja')
  expect(a.lang).toBe('ja')
  expect(a.inputmode).toBe('text')
  expect(a.spellcheck).toBe(false)
  expect(a.autocapitalize).toBe('off')
  expect(a.autocomplete).toBe('off')
  expect(a.enterkeyhint).toBe('go')
  expect(typingAttrs(undefined).lang).toBeUndefined()
  expect(typingAttrs('zh', { variant: 'simplified', enter: 'done' })).toMatchObject({
    lang: 'zh-Hans',
    enterkeyhint: 'done',
  })
})
