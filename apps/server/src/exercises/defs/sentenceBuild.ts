/** Sentence build: n+1 sentence from the words already met (DESIGN §13.7). */

import type { ExerciseContext, ExerciseDef } from '@tutor/core'
import { LEXICON, type FreqWord } from '../../seed/frequency'
import { SENTENCE_POS, buildSentence, canBuildSentence } from '../../game/grammar'
import { hasPayloadSentence, payloadTokens } from '../payload'
import { hashSeed, normalizeSentence, seededRandom } from '../seeded'
import { shuffle } from '../shared'

export const sentenceBuild: ExerciseDef<unknown> = {
  id: 'sentence_build',
  title: 'Build the sentence',
  modality: 'text',
  // Language-agnostic: any card that carries `payload.tokens` is a sentence card.
  // Mandarin frequency cards are also supported through the hand-written grammar
  // engine, so the seeded path keeps working without payload tokens.
  supports: (card) => {
    if (hasPayloadSentence(card)) return true
    if (card.targetLang !== 'zh') return false
    const entry = LEXICON.get(card.back)
    return Boolean(entry && SENTENCE_POS.has(entry.pos))
  },
  available: (ctx) => {
    if (hasPayloadSentence(ctx.card)) return true
    const entry = LEXICON.get(ctx.card.back)
    if (!entry || !ctx.known) return false
    return canBuildSentence(entry, new Set(ctx.known))
  },
  async generate(ctx) {
    const tokens = payloadTokens(ctx.card)
    // Generic path: the sentence lives on the card, so it works for any language.
    if (tokens.length >= 2) return payloadInstance(ctx, this.id, tokens)
    // Mandarin fallback: build an n+1 sentence from the known-word grammar engine.
    return grammarInstance(ctx, this.id)
  },
  async grade(_ctx, instance, answer) {
    const tokens = (instance.data.tokens as string[] | undefined) ?? []
    const expected = tokens.join('')
    const built = Array.isArray(answer)
      ? (answer as string[]).join('')
      : typeof answer === 'string'
        ? answer
        : String((answer as { tokens?: string[] })?.tokens?.join('') ?? '')
    const correct = expected.length > 0 && normalizeSentence(built) === normalizeSentence(expected)
    return {
      score: correct ? 100 : 0,
      correct,
      expected,
      feedback: correct ? undefined : `The sentence is “${expected}”.`,
    }
  },
  xp: (r) => (r.correct ? 12 + (r.score === 100 ? 3 : 0) : 1),
}

/** The instance for a card that carries its sentence in `payload`. */
function payloadInstance(ctx: ExerciseContext, exerciseId: string, tokens: string[]) {
  const payload = ctx.card.payload ?? {}
  const gloss = typeof payload.gloss === 'string' && payload.gloss ? payload.gloss : ctx.card.front
  return {
    exerciseId,
    cardId: ctx.card.id,
    modality: 'text' as const,
    prompt: `Build the sentence: “${gloss}”`,
    data: payloadData(ctx, tokens, gloss),
  }
}

/**
 * The tiles' data. No readings anywhere: the learner builds the sentence from the
 * meaning, so a reading on the tiles gives the answer away. Only an explicit
 * `newWord` is a hint — falling back to `back` would print the whole answer.
 */
function payloadData(ctx: ExerciseContext, tokens: string[], gloss: string) {
  const payload = ctx.card.payload ?? {}
  const extra = Array.isArray(payload.distractors)
    ? (payload.distractors as unknown[]).filter((d): d is string => typeof d === 'string')
    : ctx.distractors
  return {
    tokens,
    bank: shuffle([...tokens, ...extra.filter((d) => d && !tokens.includes(d)).slice(0, 3)]),
    gloss,
    target: ctx.card.back,
    answerLang: ctx.card.targetLang,
    newWord: typeof payload.newWord === 'string' ? payload.newWord : undefined,
  }
}

/** The instance for a Mandarin card the grammar engine can build a sentence for. */
function grammarInstance(ctx: ExerciseContext, exerciseId: string) {
  const entry = LEXICON.get(ctx.card.back)
  const known = new Set(ctx.known ?? [])
  const data = grammarData(ctx, entry, known)
  return {
    exerciseId,
    cardId: ctx.card.id,
    modality: 'text' as const,
    prompt: `Build the sentence: “${data.gloss}”`,
    data,
  }
}

function grammarData(ctx: ExerciseContext, entry: FreqWord | undefined, known: Set<string>) {
  const seed = hashSeed(`${ctx.card.id}:${[...known].sort().join(',')}`)
  const build = entry ? buildSentence(entry, known, seededRandom(seed)) : undefined
  // Fallback (should not happen: the route filters via `available`): build the
  // word on its own so the exercise is still usable and never crashes.
  const data = build ?? {
    tokens: [ctx.card.back],
    bank: [ctx.card.back],
    gloss: ctx.card.front,
    target: ctx.card.back,
  }
  return {
    tokens: data.tokens,
    bank: data.bank,
    gloss: data.gloss,
    target: data.target,
    answerLang: ctx.card.targetLang,
    newWord: entry?.word ?? ctx.card.back,
  }
}
