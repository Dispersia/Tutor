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

Cards and order:
- Cards come in frequency order: the most frequent word first.
- Strict n+1: each "vocab" card introduces exactly ONE new word. Any "sentence" or "grammar" card may use only words already introduced (the new word plus the ones before it).
- "vocab" cards: front = the meaning in the learner's language, back = the target word, reading = the native reading. Emit exactly one per frequency word, in the order given.

Sentence cards — natural first:
- Every sentence must be something a native speaker would actually say: grammatical, semantically sensible, short and concrete (2-6 words). A slightly less "complete" sentence that reads naturally always beats a longer sentence that does not.
- Use only words already introduced. If no natural sentence can be made from those words, OMIT the sentence card for that step. Never invent a nonsensical, semantically odd or ungrammatical sentence just to fill the slot. "My you.", "We are him.", "Daddy is one year old? No." and "I can only open the door and love you." are exactly the failures to avoid.
- payload.tokens = the sentence split into target-language tokens in order (tokens joined must equal back, ignoring trailing punctuation); payload.gloss = its plain translation; payload.distractors = 2-3 wrong tokens of the same kind. front = the same plain translation as payload.gloss.
- Add a sentence after roughly every third vocab card, and always when the instruction asks for sentences — but only when it reads naturally.

Grammar cards — a real fill-in-the-blank:
- payload.prompt = a target-language sentence with the practised word replaced by a blank written as three underscores "___". The prompt is ALWAYS in the target language, never English. Example (Mandarin): "我___茶。" with answer 喝; example (Japanese): "私は___です。" with answer 学生.
- payload.answer = the correct target-language word or form.
- payload.options (optional) = 2-3 candidate target-language forms, one of them the answer.
- payload.rule = a very short label in the learner's own language for the grammar point (e.g. "negation with 不"). payload.explanation = one short sentence in the learner's own language, shown after answering. Never write the rule or explanation in the target language.
- Use only words already introduced in the prompt sentence. Add grammar cards whenever the instruction asks for grammar.

Content rules:
- "back" is the target-language text the learner hears in the listening exercise: the word on a vocab card, the whole sentence on a sentence card. Never put the meaning, the reading or the exercise prompt in "back".
- Never write notes, parentheticals, reasoning, alternatives or meta-commentary in any field. Do not explain your choices. front/gloss are plain translations and nothing else.
- Follow the deck's reading and script rules exactly.

Translation — the whole sentence's meaning, never word by word:
- Translate what the sentence MEANS, into natural idiomatic English. Do not gloss each word in order.
- 我想你。 is "I miss you." — never "I think you." 請坐。 is "Please sit down." If the natural translation is not obvious, omit the sentence card.
- "front" and "payload.gloss" are the SAME single natural translation; never two different strings. No leading "Translate:", no quotes, no word-by-word hyphens ("to-sleep"), no "(classifier)".
- Never write pinyin or any Latin transliteration anywhere — not in front, gloss, reading, prompt, options, rule or explanation. For Chinese, readings are Zhuyin only. "rule" is a very short label and "explanation" one short sentence, both in the learner's own language, never the model's reasoning.

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

For each new word emit one "vocab" card. Weave in "sentence" cards — only when the sentence is natural, otherwise omit it — and "grammar" fill-in-the-blank cards (a target-language prompt with "___") when the instruction asks for grammar. Use only words already introduced.${known}${pitch}${hintBlock}`
}

/**
 * Phrases that only ever appear when the model leaks its own reasoning into a
 * card ("(Grammatically valid, though semantically odd)", "Wait, 來 is not
 * introduced yet"). A card that still contains one after cleaning is not usable.
 */
export const META_MARKERS =
  /\b(note:|wait,|correction|corrected|grammatically|semantically|n\+1|not introduced|introduced yet|strict n|used to test|test structure|revised|oops|as an ai|let me|let's|i'll use|i will use|i cannot|i must|per the rules|per rules|known list|however,|actually,|skip the)/i

/**
 * Strips the model's asides from a gloss or prompt: bracketed notes that read
 * like reasoning, and a trailing clause that starts with a meta marker. Plain
 * optional words such as "I have (it)." survive, because the marker test fails.
 */
export function stripMetaCommentary(text: string): string {
  // A leading "Translate:" / "Meaning:" is the model echoing its instruction.
  let out = text.replace(/^\s*(?:translate|translation|meaning|gloss|english)\s*[::]\s*/i, '')
  out = out.replace(/[（(\[][^)）\]]*[)）\]]/g, (m) => (META_MARKERS.test(m) ? ' ' : m))
  out = out.replace(
    /\s*(?:[.。!！?？]\s*)?(?:note|wait|correction|revised|actually|hmm|oops)\b[\s\S]*$/i,
    '',
  )
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.。!！?？,，、])/g, '$1')
    .trim()
}

const bare = (s: string): string => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

/** A sentence card's tokens must rebuild its `back` (ignoring spaces/punctuation). */
function tokensMatchBack(tokens: unknown, back: string): boolean {
  if (!Array.isArray(tokens)) return true
  const joined = tokens.filter((t): t is string => typeof t === 'string').join('')
  return bare(joined) === bare(back)
}

/** Cleans the free-text fields of a planned card and drops an unusable one. */
export function sanitizePlannedCard(card: PlannedCard): PlannedCard | undefined {
  const front = stripMetaCommentary(card.front)
  const back = stripMetaCommentary(card.back)
  if (!front || !back || META_MARKERS.test(front) || META_MARKERS.test(back)) return undefined
  // A blank belongs in a grammar prompt, never in the text a learner produces.
  if (back.includes('___')) return undefined

  let payload = card.payload ? { ...card.payload } : undefined
  if (payload) {
    for (const key of ['gloss', 'prompt', 'rule', 'explanation']) {
      const v = payload[key]
      if (typeof v !== 'string') continue
      const cleaned = stripMetaCommentary(v)
      // A rule is a short label and an explanation one short sentence: anything
      // long is the model thinking out loud, not something to show a learner.
      if (!cleaned || cleaned.length > 200 || META_MARKERS.test(cleaned)) delete payload[key]
      else payload[key] = cleaned
    }
    if (Array.isArray(payload.options)) {
      payload.options = payload.options
        .map((o) => (typeof o === 'string' ? stripMetaCommentary(o) : o))
        .filter((o) => o !== '')
    }
    if (Array.isArray(payload.tokens)) {
      payload.tokens = payload.tokens
        .map((t) => (typeof t === 'string' ? t.trim() : t))
        .filter((t) => t !== '')
    }
    // A sentence whose tokens no longer rebuild it is corrupt — drop it.
    if (
      card.template === 'sentence' &&
      Array.isArray(payload.tokens) &&
      payload.tokens.length >= 2 &&
      !tokensMatchBack(payload.tokens, back)
    ) {
      return undefined
    }
  }
  return { ...card, front, back, payload }
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
    const cleaned = sanitizePlannedCard({
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
    if (cleaned) out.push(cleaned)
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
