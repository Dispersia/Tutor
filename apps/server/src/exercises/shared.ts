import { pitchOf, type ExerciseContext } from '@tutor/core'
import { langName } from '../llm/prompts'
import { furiganaSegments } from '../text/furigana'
import { displayReading as nativeReading } from '../text/readings'

export const label = (lang: string): string => langName(lang)

export const readingsOf = (ctx: ExerciseContext): string[] =>
  Object.values(ctx.card.readings).filter(Boolean)

export const readingsShown = (ctx: ExerciseContext): boolean => ctx.showReadings !== false

export const displayReading = (ctx: ExerciseContext): string =>
  readingsShown(ctx) ? nativeReading(ctx.card) : ''

export const furiganaFor = (lang: string, word: string, reading: string) =>
  lang === 'ja' ? furiganaSegments(word, reading) : undefined

export const gradingReading = (ctx: ExerciseContext): string => nativeReading(ctx.card)

export const wordView = (ctx: ExerciseContext) => ({
  word: ctx.card.back,
  reading: displayReading(ctx),
  readingLang: ctx.card.targetLang,
  furigana: readingsShown(ctx)
    ? furiganaFor(ctx.card.targetLang, ctx.card.back, displayReading(ctx))
    : undefined,
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
