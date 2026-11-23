/**
 * The deck planner's prompt (docs/DESIGN.md §13.7): the system message that
 * defines the three card kinds, and the per-batch user message.
 *
 * The field contract here is what `plan.ts` validates and `context.ts` stores:
 * change a field's meaning in both places or not at all.
 */

import { langName, scriptRule } from '../llm/prompts'
import type { CharacterVariant } from '../frequency/source'

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
  /** The batch is one word the learner keeps forgetting: ask for extra practice cards. */
  reinforce?: boolean
  /** Per-word hints (reading/meaning) — used when importing an Anki deck. */
  hints?: Record<string, { reading?: string; meaning?: string }>
}

export const PLAN_SYSTEM = `You write the cards for one batch of a language-learning deck. Return only the JSON the schema asks for.

You are given the learner's instruction, the batch's new words in order, and the words the learner already knows. The instruction decides the focus: its topic, its register, and whether it wants grammar.

The deck is strictly n+1. The learner meets one new word at a time, and a sentence may use only words already met: the known words, plus the batch's words that come before it. So every sentence or grammar card goes after the vocab card of each word it uses.

The three kinds of card:

"vocab" — exactly one per new word, in the order given.
- front: the word's meaning in the learner's language. Separate several senses with " / ".
- back: the word itself. reading: its reading.

"sentence" — after about every third vocab card, one short sentence (2 to 6 words) that a native speaker would really say and that uses the word just introduced.
- back: the sentence. reading: its reading.
- front and payload.gloss: one natural translation of the whole sentence, identical in both fields.
- payload.tokens: the sentence split into its words, in order. Joined together they equal back.
- payload.distractors: 2 or 3 known words that do not belong in the sentence.
- If the words met so far cannot make a natural sentence, leave the card out. A missing sentence costs nothing; an odd one ("My you.", "We are him.") teaches something wrong.

"grammar" — only when the instruction asks for grammar. One fill-in-the-blank on one grammar point.
- payload.prompt: a target-language sentence with one word replaced by ___ (three underscores, no spaces around them).
- payload.answer and back: the missing word.
- payload.options: 2 or 3 candidate forms, one of them the answer.
- payload.rule and front: a few words naming the point, in the learner's language.
- payload.explanation: one short sentence in the learner's language.

For every card:
- A field holds its content and nothing else: no notes, alternatives, brackets or comments about your choices.
- Translate what a sentence means, not its words in order: 我想你。 is "I miss you.", not "I think you."
- Meanings, rules and explanations are in the learner's language. Words, sentences and prompts are in the target language.`

/** The user message: the instruction, the batch and one worked example. */
export function planPrompt(req: PlanRequest): string {
  return [
    `Instruction: ${req.instruction}`,
    `Target language: ${langName(req.targetLang)}. Learner's language: ${langName(req.sourceLang)}.`,
    req.topic && `Topic: ${req.topic}.`,
    scriptRule(req.targetLang, req),
    '',
    `New words for this batch, in order (${req.words.length}): ${req.words.join(' ')}`,
    knownLine(req),
    hintBlock(req),
    pitchLine(req),
    reinforceLine(req),
    '',
    `Example of the format (${exampleFor(req).about}):`,
    exampleFor(req).json,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
}

function knownLine(req: PlanRequest): string {
  if (!req.knownWords.length) return 'Words already known: none yet.'
  return `Words already known (use freely, never as a new vocab card): ${req.knownWords.slice(-60).join(' ')}`
}

/** The learner's own deck hints for the batch's words, when there are any. */
function hintBlock(req: PlanRequest): string | undefined {
  const batch = new Set(req.words)
  const hints = Object.entries(req.hints ?? {})
    .filter(([w]) => batch.has(w))
    .map(
      ([w, h]) =>
        `- ${w}${h.reading ? ` [${h.reading}]` : ''}${h.meaning ? ` = ${h.meaning}` : ''}`,
    )
  if (!hints.length) return undefined
  return `\nThe learner's own notes for these words (reading / meaning). Prefer them unless they are plainly wrong:\n${hints.join('\n')}`
}

function pitchLine(req: PlanRequest): string | undefined {
  if (!req.pitchAccent) return undefined
  return `\nAdd pitch accent to each vocab card you are sure of, as metadata.pitch: "syllables" (the word split into moras), "levels" (one "H" or "L" per mora) and "drop" (the mora after which the pitch falls, counted from 1; 0 when it never falls). Leave metadata out when unsure.`
}

function reinforceLine(req: PlanRequest): string | undefined {
  if (!req.reinforce) return undefined
  return `\nThe learner keeps forgetting ${req.words.join(' ')}. After its vocab card, write one sentence card and one grammar card that practise it with known words only.`
}

interface Example {
  about: string
  json: string
}

/**
 * One worked batch in the deck's own language and reading script. Small models
 * copy the example's shape closely, so it must not show Zhuyin to a pinyin deck
 * or Chinese to a Japanese one.
 */
function exampleFor(req: PlanRequest): Example {
  if (req.targetLang === 'zh' || req.targetLang === 'yue') return chineseExample(req)
  if (req.targetLang === 'ja') return JAPANESE_EXAMPLE
  return GENERIC_EXAMPLE
}

function chineseExample(req: PlanRequest): Example {
  const pinyin = req.readingScript === 'pinyin'
  const r = pinyin ? ['hē', 'chá', 'wǒ hē chá'] : ['ㄏㄜ', 'ㄔㄚˊ', 'ㄨㄛˇ ㄏㄜ ㄔㄚˊ']
  return {
    about: 'known: 我 你 他 — new: 喝 茶 — the instruction asked for grammar',
    json: JSON.stringify({
      cards: [
        { template: 'vocab', front: 'to drink', back: '喝', reading: r[0] },
        { template: 'vocab', front: 'tea', back: '茶', reading: r[1] },
        { ...SENTENCE_ZH, reading: r[2] },
        GRAMMAR_ZH,
      ],
    }),
  }
}

const SENTENCE_ZH = {
  template: 'sentence',
  front: 'I drink tea.',
  back: '我喝茶。',
  payload: { tokens: ['我', '喝', '茶'], gloss: 'I drink tea.', distractors: ['你', '他'] },
}

const GRAMMAR_ZH = {
  template: 'grammar',
  front: 'verb before object',
  back: '喝',
  payload: {
    prompt: '我___茶。',
    answer: '喝',
    options: ['喝', '茶'],
    rule: 'verb before object',
    explanation: 'The verb comes before the thing it acts on.',
  },
}

const JAPANESE_EXAMPLE: Example = {
  about: 'known: 私 は です 先生 本 — new: 学生 — the instruction asked for grammar',
  json: JSON.stringify({
    cards: [
      { template: 'vocab', front: 'student', back: '学生', reading: 'がくせい' },
      {
        template: 'sentence',
        front: 'I am a student.',
        back: '私は学生です。',
        reading: 'わたしはがくせいです',
        payload: {
          tokens: ['私', 'は', '学生', 'です'],
          gloss: 'I am a student.',
          distractors: ['先生', '本'],
        },
      },
      {
        template: 'grammar',
        front: 'topic particle',
        back: 'は',
        payload: {
          prompt: '私___学生です。',
          answer: 'は',
          options: ['は', 'です'],
          rule: 'topic particle',
          explanation: 'は marks what the sentence is about.',
        },
      },
    ],
  }),
}

const GENERIC_EXAMPLE: Example = {
  about: 'Spanish for an English speaker; known: yo no — new: bebo agua',
  json: JSON.stringify({
    cards: [
      { template: 'vocab', front: 'I drink', back: 'bebo' },
      { template: 'vocab', front: 'water', back: 'agua' },
      {
        template: 'sentence',
        front: 'I drink water.',
        back: 'Bebo agua.',
        payload: { tokens: ['Bebo', 'agua'], gloss: 'I drink water.', distractors: ['yo', 'no'] },
      },
    ],
  }),
}
