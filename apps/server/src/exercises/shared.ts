/** Helpers every exercise needs: language labels, readings and the word view. */

import { pitchOf, type ExerciseContext } from '@tutor/core'
import { langName } from '../llm/prompts'
import { furiganaSegments } from '../text/furigana'
import { displayReading as nativeReading } from '../text/readings'

/** A language's display name — the one table is `langName` (`llm/prompts.ts`). */
export const label = (lang: string): string => langName(lang)

export const readingsOf = (ctx: ExerciseContext): string[] =>
  Object.values(ctx.card.readings).filter(Boolean)

/** Whether native readings should be shown (the learner can turn them off). */
export const readingsShown = (ctx: ExerciseContext): boolean => ctx.showReadings !== false

/**
 * The reading a learner should see: Zhuyin for Chinese, kana (furigana) for
 * Japanese. Never Latin transliteration — a legacy pinyin value is converted.
 * Empty when the learner has hidden readings in their study preferences.
 */
export const displayReading = (ctx: ExerciseContext): string =>
  readingsShown(ctx) ? nativeReading(ctx.card) : ''

/** Furigana ruby segments for a Japanese word (undefined for other languages). */
export const furiganaFor = (lang: string, word: string, reading: string) =>
  lang === 'ja' ? furiganaSegments(word, reading) : undefined

/**
 * The phonetic reading handed to the pronunciation judge, regardless of the
 * learner's display preference. The judge is unreliable at recalling Zhuyin and
 * has produced wrong readings (ㄕㄧˋ for ㄕˋ) and Latin look-alikes ("shee"), so
 * it is given the card's own reading to copy verbatim.
 */
export const gradingReading = (ctx: ExerciseContext): string => nativeReading(ctx.card)

/** The target word plus the reading the learner should see (Zhuyin / furigana). */
export const wordView = (ctx: ExerciseContext) => ({
  word: ctx.card.back,
  reading: displayReading(ctx),
  readingLang: ctx.card.targetLang,
  furigana: readingsShown(ctx)
    ? furiganaFor(ctx.card.targetLang, ctx.card.back, displayReading(ctx))
    : undefined,
  // Pitch accent rides on the reading, so hiding readings hides it too.
  pitch: readingsShown(ctx) ? pitchOf(ctx.card.metadata) : undefined,
})

export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
