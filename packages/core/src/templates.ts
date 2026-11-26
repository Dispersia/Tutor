import type { Modality } from './types'

export type TemplateKind = 'vocab' | 'spoken' | 'listening' | 'grammar' | 'sentence'

export type TemplateFieldKind = 'text' | 'reading' | 'audio' | 'tokens' | 'options' | 'json'

export interface TemplateField {
  path: string
  label: string
  kind: TemplateFieldKind
  required: boolean
  description: string
}

export interface CardTemplate {
  kind: TemplateKind
  title: string
  summary: string
  modality: Modality
  fields: TemplateField[]
  exercises: string[]
}

const readingField: TemplateField = {
  path: 'readings.*',
  label: 'Reading',
  kind: 'reading',
  required: false,
  description: 'Native phonetic script (Zhuyin, kana, …); never a Latin transliteration.',
}

const meaningField: TemplateField = {
  path: 'front',
  label: 'Meaning',
  kind: 'text',
  required: true,
  description: "The card's meaning in the learner's own language.",
}

const targetField: TemplateField = {
  path: 'back',
  label: 'Target text',
  kind: 'audio',
  required: true,
  description: 'The target-language text the card teaches (word, phrase or sentence).',
}

export const CARD_TEMPLATES: readonly CardTemplate[] = [
  {
    kind: 'vocab',
    title: 'Vocabulary',
    summary: 'Recall what a word means and how to say it.',
    modality: 'text',
    fields: [meaningField, targetField, readingField],
    exercises: ['translate.front_to_back', 'translate.back_to_front', 'multiple_choice'],
  },
  {
    kind: 'listening',
    title: 'Listening',
    summary: 'Hear the target text and write down what you heard.',
    modality: 'voice',
    fields: [targetField, readingField],
    exercises: ['type_listen'],
  },
  {
    kind: 'spoken',
    title: 'Speaking',
    summary: 'Say the target text out loud and get pronunciation feedback.',
    modality: 'voice',
    fields: [targetField, readingField],
    exercises: ['speak_word', 'converse'],
  },
  {
    kind: 'sentence',
    title: 'Sentence building',
    summary: 'Build or type a whole sentence from its meaning.',
    modality: 'text',
    fields: [
      {
        path: 'payload.tokens',
        label: 'Tokens',
        kind: 'tokens',
        required: true,
        description: 'The sentence split into target-language tokens, in order.',
      },
      {
        path: 'payload.gloss',
        label: 'Gloss',
        kind: 'text',
        required: false,
        description: 'The sentence meaning, shown as the prompt (defaults to "front").',
      },
      {
        path: 'payload.distractors',
        label: 'Distractor tokens',
        kind: 'options',
        required: false,
        description: 'Extra tiles mixed into the bank (defaults to same-language cards).',
      },
      readingField,
    ],
    exercises: ['sentence_build'],
  },
  {
    kind: 'grammar',
    title: 'Grammar',
    summary: 'Apply a grammar rule to a pattern or fill in the right form.',
    modality: 'text',
    fields: [
      {
        path: 'payload.prompt',
        label: 'Prompt',
        kind: 'text',
        required: false,
        description: 'The instruction shown to the learner (defaults to "front").',
      },
      {
        path: 'payload.answer',
        label: 'Answer',
        kind: 'text',
        required: true,
        description: 'The correct target-language form (defaults to "back").',
      },
      {
        path: 'payload.options',
        label: 'Options',
        kind: 'options',
        required: false,
        description: 'Candidate forms for a choice card; omit for free typing.',
      },
      {
        path: 'payload.rule',
        label: 'Rule',
        kind: 'text',
        required: false,
        description: 'The grammar point this card practises, e.g. "negation with 不".',
      },
      {
        path: 'payload.explanation',
        label: 'Explanation',
        kind: 'text',
        required: false,
        description: 'A short note shown in the feedback after answering.',
      },
      readingField,
    ],
    exercises: ['grammar_cloze'],
  },
] as const

export function templateForExercise(exerciseId: string): CardTemplate | undefined {
  return CARD_TEMPLATES.find((t) => t.exercises.includes(exerciseId))
}
