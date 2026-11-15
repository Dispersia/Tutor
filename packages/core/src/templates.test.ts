import { expect, test } from 'bun:test'
import {
  CARD_TEMPLATES,
  TEMPLATE_BY_KIND,
  templateForExercise,
  templatesForCard,
} from './templates'

test('the five built-in templates cover the practice functions', () => {
  expect(CARD_TEMPLATES.map((t) => t.kind)).toEqual([
    'vocab',
    'listening',
    'spoken',
    'sentence',
    'grammar',
  ])
  for (const t of CARD_TEMPLATES) {
    expect(TEMPLATE_BY_KIND[t.kind]).toBe(t)
    expect(t.fields.length).toBeGreaterThan(0)
    expect(t.exercises.length).toBeGreaterThan(0)
  }
})

test('every exercise belongs to exactly one template', () => {
  const seen = new Set<string>()
  for (const t of CARD_TEMPLATES) {
    for (const id of t.exercises) {
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  }
})

test('templateForExercise maps exercise ids to their template', () => {
  expect(templateForExercise('speak_word')?.kind).toBe('spoken')
  expect(templateForExercise('type_listen')?.kind).toBe('listening')
  expect(templateForExercise('sentence_build')?.kind).toBe('sentence')
  expect(templateForExercise('grammar_cloze')?.kind).toBe('grammar')
  expect(templateForExercise('multiple_choice')?.kind).toBe('vocab')
  expect(templateForExercise('nope')).toBeUndefined()
})

test('templatesForCard reads the card payload, language-agnostically', () => {
  const word = templatesForCard({ payload: {} }).map((t) => t.kind)
  expect(word).toContain('vocab')
  expect(word).not.toContain('sentence')
  expect(word).not.toContain('grammar')

  const sentence = templatesForCard({ payload: { tokens: ['我', '喝', '茶'] } }).map((t) => t.kind)
  expect(sentence).toContain('sentence')

  const grammar = templatesForCard({ payload: { answer: 'soy', rule: 'ser' } }).map((t) => t.kind)
  expect(grammar).toContain('grammar')
})
