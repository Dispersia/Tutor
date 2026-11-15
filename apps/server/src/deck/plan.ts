import type { OpenRouter, ReasoningEffort } from '../llm/openrouter'
import { parsePitchContour } from '@tutor/core'
import { langName } from '../llm/prompts'
import type { CharacterVariant } from '../frequency/source'

/**
 * Turns a user instruction + a pulled frequency list into cards that fit the
 * card templates (docs/DESIGN.md §11). The planner is the only LLM call in the
 * deck builder; it is injected so tests run with no key.
 */

/** The template kinds the deck builder generates. */
export type PlanTemplate = 'vocab' | 'sentence' | 'grammar'

export interface PlannedCard {
  template: PlanTemplate
  /** Meaning in the learner's language. */
  front: string
  /** Target-language text. */
  back: string
  /** Native-script reading (Zhuyin / kana). */
  reading?: string
  /** Extra structured content (tokens, answer, options, …) per template. */
  payload?: Record<string, unknown>
  /** Language-specific annotations (pitch accent, …). */
  metadata?: Record<string, unknown>
}

export interface PlanRequest {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
  /** Frequency words to turn into cards, most frequent first. */
  words: string[]
  /** Words the learner already has (so example cards stay n+1). */
  knownWords: string[]
  variant?: CharacterVariant
  readingScript?: string
  /** How many new words this batch should introduce. */
  count: number
  /** Ask the planner for pitch-accent metadata (Japanese, …). */
  pitchAccent?: boolean
  /** Per-word hints (reading/meaning) — used when importing an Anki deck. */
  hints?: Record<string, { reading?: string; meaning?: string }>
}

export type Planner = (req: PlanRequest) => Promise<PlannedCard[]>

const PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    tokens: { type: 'array', items: { type: 'string' } },
    gloss: { type: 'string' },
    distractors: { type: 'array', items: { type: 'string' } },
    prompt: { type: 'string' },
    answer: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    rule: { type: 'string' },
    explanation: { type: 'string' },
  },
  additionalProperties: false,
}

/**
 * Language-agnostic annotations. `pitch` is the one shape the app renders; the
 * rest is an open bag so a new language can annotate a card without a schema
 * change. Pitch levels are one per mora; `drop` is the accent nucleus, counted
 * from 1 (the mora after which the pitch falls).
 */
const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    pitch: {
      type: 'object',
      properties: {
        syllables: { type: 'array', items: { type: 'string' } },
        levels: { type: 'array', items: { type: 'string', enum: ['H', 'L'] } },
        drop: { type: 'integer' },
      },
      required: ['levels'],
      additionalProperties: false,
    },
  },
  additionalProperties: true,
}

export const DECK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          template: { type: 'string', enum: ['vocab', 'sentence', 'grammar'] },
          front: { type: 'string' },
          back: { type: 'string' },
          reading: { type: 'string' },
          payload: PAYLOAD_SCHEMA,
          metadata: METADATA_SCHEMA,
        },
        required: ['template', 'front', 'back'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

/** The reading/ruby rules a deck must follow, derived from its settings. */
export function readingRules(targetLang: string, variant?: CharacterVariant): string {
  if (targetLang === 'zh' || targetLang === 'yue') {
    const chars =
      variant === 'simplified'
        ? 'Simplified characters (简体字) only — never Traditional'
        : 'Traditional characters (繁體字) only — never Simplified'
    return `Write ${chars}. Write every reading in Zhuyin (注音/bopomofo) only — never pinyin or any Latin transliteration.`
  }
  if (targetLang === 'ja') {
    return 'Write readings in kana only — never romaji or any Latin transliteration.'
  }
  return 'Do not use Latin transliteration; keep the target text in its native script.'
}

const SYSTEM = `You build a language-learning deck from a real frequency list. You return only the requested JSON.

The learner's instruction is the source of truth, for this batch exactly as for the first one. If it asks for grammar, include grammar cards. If it names a topic, level or register, keep that focus.

Rules:
- Cards come in frequency order: the most frequent word first.
- Strict n+1: each "vocab" card introduces exactly ONE new word. Any "sentence" or "grammar" card may use only words already introduced (the new word plus the ones before it).
- "vocab" cards: front = the meaning in the learner's language, back = the target word, reading = the native reading. Emit exactly one per frequency word, in the order given.
- "sentence" cards: payload.tokens = the sentence split into target-language tokens in order; payload.gloss = its meaning; payload.distractors = 2-3 wrong tokens of the same kind. Use only known words. Add one after roughly every third vocab card, and always when the instruction asks for sentences.
- "grammar" cards: payload.answer = the correct form, payload.prompt = the instruction, and either payload.options (a choice card) or nothing (free typing); payload.rule names the grammar point. Use only known words. Add them whenever the instruction asks for grammar.
- "back" is the text the learner hears in the listening exercise: the word on a vocab card, the whole sentence on a sentence card. Never put the meaning, the reading or the exercise prompt in "back".
- Follow the deck's reading and script rules exactly.

Metadata:
- "metadata" holds language-specific annotations that do not fit front/back/reading. It is optional; omit it when you have nothing to add.
- For Japanese, when asked, add metadata.pitch: the word's pitch accent as one level per mora, "H" or "L", in "levels"; the mora split in "syllables"; and "drop", the accent nucleus counted from 1 (the mora after which the pitch falls; 0 = heiban, no in-word drop). Only add pitch you are confident about.`

/** The user message: the instruction, the rules and the raw frequency words. */
export function planPrompt(req: PlanRequest): string {
  const rules = readingRules(req.targetLang, req.variant)
  const script = req.readingScript ? `\nReading script: ${req.readingScript}.` : ''
  const topic = req.topic ? `\nTopic focus: ${req.topic}.` : ''
  const known = req.knownWords.length
    ? `\nWords the learner already knows (reuse freely, never re-introduce): ${req.knownWords.slice(-60).join(' ')}`
    : ''
  const batch = new Set(req.words.slice(0, req.count))
  const hints = req.hints
    ? Object.entries(req.hints)
        .filter(([w]) => batch.has(w))
        .map(
          ([w, h]) =>
            `- ${w}${h.reading ? ` [${h.reading}]` : ''}${h.meaning ? ` = ${h.meaning}` : ''}`,
        )
    : []
  const hintBlock = hints.length
    ? `\n\nHints from the learner's own deck (reading / meaning — verify, do not copy blindly):\n${hints.join('\n')}`
    : ''
  const pitch = req.pitchAccent
    ? `\n\nThis deck wants pitch-accent metadata: for each vocab card add metadata.pitch (levels, syllables, drop) when you are confident of the standard accent.`
    : ''
  return `Instruction (applies to this batch too): ${req.instruction}
Target language: ${langName(req.targetLang)}. Learner's language: ${langName(req.sourceLang)}.${topic}${script}
${rules}

Introduce the next ${req.count} new words from this list, in order (skip any already known):
${req.words.join(' ')}

For each new word emit one "vocab" card. Weave in "sentence" (and, if the instruction asks for it, "grammar") cards using only words already introduced.${known}${pitch}${hintBlock}`
}

/** Normalises whatever the model returned into valid PlannedCards. */
export function normalizePlan(raw: unknown): PlannedCard[] {
  const cards = (raw as { cards?: unknown } | undefined)?.cards
  if (!Array.isArray(cards)) return []
  const out: PlannedCard[] = []
  for (const c of cards) {
    const card = c as Partial<PlannedCard> & { template?: string }
    if (!card || typeof card.front !== 'string' || typeof card.back !== 'string') continue
    const template: PlanTemplate =
      card.template === 'sentence' || card.template === 'grammar' ? card.template : 'vocab'
    out.push({
      template,
      front: card.front,
      back: card.back,
      reading: typeof card.reading === 'string' ? card.reading : undefined,
      payload:
        card.payload && typeof card.payload === 'object'
          ? (card.payload as Record<string, unknown>)
          : undefined,
      metadata: normalizeMetadata(card.metadata),
    })
  }
  return out
}

/** Keeps only annotations we can store, normalising pitch into a contour. */
function normalizeMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, unknown> = {}
  const pitch = parsePitchContour((raw as Record<string, unknown>).pitch)
  if (pitch) out.pitch = pitch
  return Object.keys(out).length ? out : undefined
}

/** An OpenRouter-backed planner using the given (generator) model. */
export function llmPlanner(or: OpenRouter, model: string, reasoning: ReasoningEffort): Planner {
  return async (req) => {
    const { json } = await or.chatJSON({
      model,
      schema: DECK_SCHEMA,
      schemaName: 'deck',
      reasoning,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: planPrompt(req) },
      ],
    })
    return normalizePlan(json)
  }
}
