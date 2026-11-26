import { expect, test } from 'bun:test'
import { CARD_TEMPLATES, templateForExercise } from './templates'

test('the five built-in templates cover the practice functions', () => {
  expect(CARD_TEMPLATES.map((t) => t.kind)).toEqual([
    'vocab',
    'listening',
    'spoken',
    'sentence',
    'grammar',
  ])
  const byKind = new Map(CARD_TEMPLATES.map((t) => [t.kind, t]))
  for (const t of CARD_TEMPLATES) {
    expect(byKind.get(t.kind)).toBe(t)
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
