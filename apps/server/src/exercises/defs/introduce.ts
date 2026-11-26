import type { ExerciseContext, ExerciseDef } from '@tutor/core'
import { LEXICON } from '../../text/lexicon'
import { SENTENCE_POS, buildSentence, canBuildSentence } from '../../game/grammar'
import { pinyinToZhuyin } from '../../text/zhuyin'
import { payloadString } from '../payload'
import { hashSeed, seededRandom } from '../seeded'
import { BLANK, distinctReading, readingsShown, wordView } from '../shared'

export const INTRODUCE_ID = 'introduce'

function exampleFor(
  ctx: ExerciseContext,
): { text: string; reading: string; gloss: string; target: string } | undefined {
  if (ctx.card.targetLang !== 'zh') return undefined
  const entry = LEXICON.get(ctx.card.back)
  if (!entry || !SENTENCE_POS.has(entry.pos)) return undefined
  const known = new Set([...(ctx.seen ?? ctx.known ?? []), ctx.card.back])
  if (!canBuildSentence(entry, known)) return undefined
  const build = buildSentence(entry, known, seededRandom(hashSeed(ctx.card.id)))
  if (!build) return undefined
  return {
    text: build.tokens.join(''),
    reading: readingsShown(ctx) ? tokensZhuyin(build.tokens) : '',
    gloss: build.gloss,
    target: build.target,
  }
}

interface GrammarIntro {
  rule: string
  explanation?: string
  example?: { text: string; target?: string; gloss?: string; reading?: string }
}

function grammarFor(ctx: ExerciseContext): GrammarIntro | undefined {
  if (!isGrammar(ctx)) return undefined
  return {
    rule: ctx.card.front,
    explanation: payloadString(ctx.card, 'explanation'),
    example: grammarExample(ctx),
  }
}

function isGrammar(ctx: ExerciseContext): boolean {
  return ctx.card.type === 'grammar' || ctx.card.payload?.template === 'grammar'
}

function grammarExample(ctx: ExerciseContext): GrammarIntro['example'] {
  const stored = storedExample(ctx.card.payload)
  if (stored) return stored
  const prompt = payloadString(ctx.card, 'prompt')
  const answer = payloadString(ctx.card, 'answer') ?? ctx.card.back
  if (!answer) return undefined
  const text = prompt?.includes(BLANK) ? prompt.replace(BLANK, answer) : answer
  return { text, target: answer }
}

function storedExample(payload: Record<string, unknown> | undefined): GrammarIntro['example'] {
  const raw = payload?.example
  if (!raw || typeof raw !== 'object') return undefined
  const example = raw as Record<string, unknown>
  if (typeof example.text !== 'string' || !example.text) return undefined
  return {
    text: example.text,
    gloss: typeof example.gloss === 'string' ? example.gloss : undefined,
    reading:
      distinctReading(example.text, typeof example.reading === 'string' ? example.reading : '') ||
      undefined,
  }
}

function tokensZhuyin(tokens: string[]): string {
  const zhuyinOf = (t: string) => {
    const e = LEXICON.get(t)
    return e ? pinyinToZhuyin(e.pinyin) : ''
  }
  return tokens.map(zhuyinOf).filter(Boolean).join(' ')
}

export const introduce: ExerciseDef<string> = {
  id: INTRODUCE_ID,
  title: 'Meet a new word',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    const grammar = grammarFor(ctx)
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: introPrompt(ctx, grammar),
      data: {
        ...wordView(ctx),
        meaning: ctx.card.front,
        explanation: grammar ? undefined : payloadString(ctx.card, 'explanation'),
        example: exampleFor(ctx) ?? (grammar ? undefined : storedExample(ctx.card.payload)),
        grammar,
      },
    }
  },
  async grade(ctx) {
    return { score: 100, correct: true, expected: ctx.card.back }
  },
  xp: () => 0,
}

function introPrompt(ctx: ExerciseContext, grammar: GrammarIntro | undefined): string {
  if (grammar) return `A new pattern: “${grammar.rule}”`
  return `A new word: “${ctx.card.front}”`
}
