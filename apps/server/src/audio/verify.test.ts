import { expect, test } from 'bun:test'
import { saysExactly } from './verify'

test('a single word must be the word and nothing else', () => {
  const tea = { text: '茶', language: 'zh' }
  expect(saysExactly(tea, '茶。')).toBe(true)
  // the model kept talking after the word
  expect(saysExactly(tea, '茶，我喜歡喝茶。')).toBe(false)
  // noise, or nothing recognisable
  expect(saysExactly(tea, '')).toBe(false)
  expect(saysExactly(tea, '嗯')).toBe(false)
})

test('a Mandarin homophone is the same sound, so it passes', () => {
  expect(saysExactly({ text: '他', language: 'zh' }, '她')).toBe(true)
  expect(saysExactly({ text: '他', language: 'zh' }, '大')).toBe(false)
})

test('a Japanese word passes when the transcript has its reading', () => {
  const teacher = { text: '先生', language: 'ja', kana: 'せんせい' }
  expect(saysExactly(teacher, '先生')).toBe(true)
  expect(saysExactly(teacher, 'せんせい')).toBe(true)
  expect(saysExactly(teacher, 'センセイ')).toBe(true)
  // read as Mandarin, the recogniser hears something else entirely
  expect(saysExactly(teacher, 'シェンシェン')).toBe(false)
  // 橋 and 箸 are both はし: the recogniser cannot tell them apart, so either passes
  expect(saysExactly({ text: '橋', language: 'ja', kana: 'はし' }, '箸')).toBe(true)
})

test('a sentence forgives a small slip but not an extra clause', () => {
  const s = { text: 'Ich trinke jeden Morgen Kaffee.', language: 'de' }
  expect(saysExactly(s, 'ich trinke jeden Morgen Kaffee')).toBe(true)
  expect(saysExactly(s, 'Ich trinke jeden Morgen Kafee.')).toBe(true)
  expect(saysExactly(s, 'Ich trinke jeden Morgen Kaffee. Und du, was trinkst du?')).toBe(false)
  expect(saysExactly({ text: 'agua', language: 'es' }, 'Agua.')).toBe(true)
  expect(saysExactly({ text: 'agua', language: 'es' }, 'aguas')).toBe(false)
})
