import type { ExerciseContext, ExerciseDef } from '@tutor/core'
import { hasPayloadSentence, payloadTokens } from '../payload'
import { displayReading, frontRevealsAnswer, furiganaFor, readingsShown, shuffle } from '../shared'

const PUNCTUATION = /^[\p{P}\p{S}]+$/u
const SENTENCE_END = /[。！？!?…]/
const MAX_CHOICES = 4
const MAX_DISTRACTORS = MAX_CHOICES - 1

export const multipleChoice: ExerciseDef<string> = {
  id: 'multiple_choice',
  title: 'Pick the right answer',
  modality: 'text',
  supports: (card) => card.back.length <= 12 && !frontRevealsAnswer(card),
  available: (ctx) => distractorOptions(ctx).length >= 1,
  async generate(ctx) {
    const choices = shuffle([ctx.card.back, ...distractorOptions(ctx)]).slice(0, MAX_CHOICES)
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `Which one means “${ctx.card.front}”?`,
      data: {
        choices,
        choiceReadings: readingsShown(ctx) ? choices.map((c) => ctx.readings?.[c] ?? '') : [],
        choiceFurigana: readingsShown(ctx)
          ? choices.map((c) => furiganaFor(ctx.card.targetLang, c, ctx.readings?.[c] ?? ''))
          : [],
        reading: displayReading(ctx),
        readingLang: ctx.card.targetLang,
      },
    }
  },
  async grade(ctx, _instance, answer) {
    const correct = String(answer ?? '').trim() === ctx.card.back
    return {
      score: correct ? 100 : 0,
      correct,
      expected: ctx.card.back,
      feedback: correct ? undefined : `“${ctx.card.front}” is ${ctx.card.back}.`,
    }
  },
  xp: (r) => (r.correct ? 8 : 1),
}

function distractorOptions(ctx: ExerciseContext): string[] {
  if (!hasPayloadSentence(ctx.card)) return ctx.distractors
  const variants = sentenceVariants(ctx)
  return variants.length > 0 ? variants : ctx.distractors
}

function sentenceVariants(ctx: ExerciseContext): string[] {
  const tokens = payloadTokens(ctx.card)
  const back = ctx.card.back
  const inSentence = new Set(tokens)
  const out: string[] = []
  for (const word of swapWords(ctx, inSentence)) {
    const variant = replaceToken(tokens, back, word)
    if (variant !== back && !out.includes(variant)) out.push(variant)
    if (out.length >= MAX_DISTRACTORS) break
  }
  return out
}

function swapWords(ctx: ExerciseContext, inSentence: Set<string>): string[] {
  const curated = usableSwapWords(ctx.card.payload?.distractors, inSentence)
  if (curated.length) return curated
  return usableSwapWords([...ctx.distractors, ...(ctx.seen ?? [])], inSentence)
}

function usableSwapWords(raw: unknown, inSentence: Set<string>): string[] {
  const words = Array.isArray(raw) ? raw.filter(isString) : []
  return [...new Set(words)].filter((w) => isSwapWord(w) && !inSentence.has(w))
}

const isString = (v: unknown): v is string => typeof v === 'string'

const isSwapWord = (w: string): boolean => w.length > 0 && !SENTENCE_END.test(w) && !/\s/.test(w)

function replaceToken(tokens: string[], back: string, word: string): string {
  const next = [...tokens]
  next[bestSwapIndex(tokens, word)] = word
  return joinTokens(next, back)
}

function bestSwapIndex(tokens: string[], word: string): number {
  let best = 0
  let bestScore = -Infinity
  tokens.forEach((token, index) => {
    if (PUNCTUATION.test(token)) return
    const score = matchScore(token, word)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })
  return best
}

function matchScore(token: string, word: string): number {
  return commonSuffix(token, word) * 2 - Math.abs(token.length - word.length)
}

function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function joinTokens(tokens: string[], back: string): string {
  const joined = tokens.join('')
  if (joined === back) return joined
  const spaced = tokens.join(' ')
  return spaced === back ? spaced : joined
}
