/** Introduce: the first exposure teaches, it never quizzes (DESIGN §13.7). */

import type { ExerciseContext, ExerciseDef } from '@tutor/core'
import { LEXICON } from '../../text/lexicon'
import { SENTENCE_POS, buildSentence, canBuildSentence } from '../../game/grammar'
import { pinyinToZhuyin } from '../../text/zhuyin'
import { hashSeed, seededRandom } from '../seeded'
import { readingsShown, wordView } from '../shared'

/** Registry id of the first-exposure "teach" step. */
export const INTRODUCE_ID = 'introduce'

/** A short n+1 example sentence for the new word, using only words already met. */
export function exampleFor(
  ctx: ExerciseContext,
): { text: string; reading: string; gloss: string; target: string } | undefined {
  if (ctx.card.targetLang !== 'zh') return undefined
  const entry = LEXICON.get(ctx.card.back)
  if (!entry || !SENTENCE_POS.has(entry.pos)) return undefined
  // n+1: every other token must be a word the learner has already met.
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

/** The space-joined Zhuyin of a token run (unknown tokens dropped). */
function tokensZhuyin(tokens: string[]): string {
  const zhuyinOf = (t: string) => {
    const e = LEXICON.get(t)
    return e ? pinyinToZhuyin(e.pinyin) : ''
  }
  return tokens.map(zhuyinOf).filter(Boolean).join(' ')
}

/**
 * The first time a learner meets a card, this presents it — the word, its native
 * reading and its meaning, with an example — instead of quizzing something they
 * have not been shown. It is never part of the drill rotation (`pickNextExercise`
 * filters it out); the practice route forces it for a new, unintroduced card.
 */
export const introduce: ExerciseDef<string> = {
  id: INTRODUCE_ID,
  title: 'Meet a new word',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `A new word: “${ctx.card.front}”`,
      data: {
        ...wordView(ctx),
        meaning: ctx.card.front,
        example: exampleFor(ctx),
      },
    }
  },
  async grade(ctx) {
    // Nothing to recall yet — the teach step always "passes" and never schedules.
    return { score: 100, correct: true, expected: ctx.card.back }
  },
  xp: () => 0,
}
