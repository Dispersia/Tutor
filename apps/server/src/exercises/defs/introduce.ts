import type { ExerciseContext, ExerciseDef } from '@tutor/core'
import { LEXICON } from '../../text/lexicon'
import { SENTENCE_POS, buildSentence, canBuildSentence } from '../../game/grammar'
import { pinyinToZhuyin } from '../../text/zhuyin'
import { hashSeed, seededRandom } from '../seeded'
import { readingsShown, wordView } from '../shared'

export const INTRODUCE_ID = 'introduce'

export function exampleFor(
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
    return { score: 100, correct: true, expected: ctx.card.back }
  },
  xp: () => 0,
}
