import type { Card, Modality } from './types'

/**
 * Card templates (docs/DESIGN.md §11).
 *
 * A *template* is the reusable shape of a practice card: the content it needs
 * and the function it serves. Templates are language-agnostic — a "vocab"
 * template works for Mandarin, Japanese, Spanish or anything else, because it
 * names its content by role (`back` is "the target-language text") rather than
 * by script. The five built-ins cover the functions the app practises today:
 *
 *   vocab      recall a word's meaning
 *   spoken     say a word/sentence out loud
 *   listening  transcribe what you hear
 *   grammar    apply a rule to a pattern
 *   sentence   arrange/type a whole sentence
 *
 * A card's *content* is the existing `Card` model (`front`, `back`, `readings`,
 * `payload`). A template only declares which parts of that model it reads, so a
 * single card can be reused by several templates (one word card is practised as
 * vocab, spoken and listening) and a single template can be reused across every
 * language. Adding a template means describing its fields and registering the
 * exercises that realise it — nothing in the card model changes.
 */

export type TemplateKind = 'vocab' | 'spoken' | 'listening' | 'grammar' | 'sentence'

/** How a template field is read off a card. */
export type TemplateFieldKind =
  /** a plain string (meaning, gloss, prompt) */
  | 'text'
  /** a native-script phonetic reading (Zhuyin, kana, …) — never Latin */
  | 'reading'
  /** target-language text that is synthesised to speech for the learner */
  | 'audio'
  /** an ordered list of target-language tokens (a segmented sentence) */
  | 'tokens'
  /** a list of candidate answers for a choice card */
  | 'options'
  /** structured extras (grammar slots, patterns) */
  | 'json'

export interface TemplateField {
  /** Dotted path on the `Card`: `back`, `readings.kana`, `payload.tokens`. */
  path: string
  label: string
  kind: TemplateFieldKind
  required: boolean
  /** What the field holds, in plain words (shown in authoring UIs). */
  description: string
}

export interface CardTemplate {
  kind: TemplateKind
  /** Short name for the practice function, e.g. "Vocabulary". */
  title: string
  /** One-line summary of what the learner does. */
  summary: string
  /** The modality most instances of this template use. */
  modality: Modality
  /** The reusable content model: what a card must carry to use this template. */
  fields: TemplateField[]
  /**
   * Exercise ids (the server registry) that realise this template. An exercise
   * id is stable; templates only group them by function.
   */
  exercises: string[]
}

/** Native-script reading — the template never names a script, only the role. */
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

/**
 * The five built-in templates. Order is the order a learner meets them: the
 * word first, then hearing it, then producing it, then the patterns around it.
 */
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

/** Look up a template by its kind. */
export const TEMPLATE_BY_KIND: Record<TemplateKind, CardTemplate> = Object.fromEntries(
  CARD_TEMPLATES.map((t) => [t.kind, t]),
) as Record<TemplateKind, CardTemplate>

/** The template that owns an exercise id, if any. */
export function templateForExercise(exerciseId: string): CardTemplate | undefined {
  return CARD_TEMPLATES.find((t) => t.exercises.includes(exerciseId))
}

/**
 * The templates a card can be practised with, in template order. Reads only the
 * card's content (`payload`), so it is language-agnostic: a card carrying
 * `payload.tokens` is a sentence card in any language.
 */
export function templatesForCard(card: Pick<Card, 'payload'>): CardTemplate[] {
  const payload = card.payload ?? {}
  const has = (key: string) => {
    const v = payload[key]
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''
  }
  return CARD_TEMPLATES.filter((t) => {
    if (t.kind === 'sentence') return has('tokens')
    if (t.kind === 'grammar') return has('answer') || has('options') || has('rule')
    return true
  })
}
