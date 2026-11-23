import { expect, test } from 'bun:test'
import { speakable } from './speech'

test('speakable strips what a speech model would read out or stumble on', () => {
  expect(speakable('**你好**！今天好嗎？')).toBe('你好 ！今天好嗎？')
  expect(speakable('我喜歡喝茶 (ㄏㄜ ㄔㄚˊ)。')).toBe('我喜歡喝茶 。')
  expect(speakable('你好 (nǐ hǎo)!')).toBe('你好 !')
  expect(speakable('学生（がくせい）です。')).toBe('学生です。')
  expect(speakable('- Great job! 🎉')).toBe('Great job!')
  expect(speakable('See [the docs](https://example.com).')).toBe('See the docs.')
})

test('speakable keeps ordinary brackets and plain sentences', () => {
  expect(speakable('I have (it).')).toBe('I have (it).')
  expect(speakable('今日は何をしますか？')).toBe('今日は何をしますか？')
})

test('speakable is empty when nothing is left to say', () => {
  expect(speakable('🎉')).toBe('')
  expect(speakable('***')).toBe('')
})
