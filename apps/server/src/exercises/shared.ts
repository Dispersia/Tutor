import { pitchOf, type Card, type ExerciseContext } from '@tutor/core'
import { langName } from '../llm/prompts'
import { furiganaWords, type FuriganaSegment } from '../text/furigana'
import { bareText } from '../text/normalize'
import { displayReading as nativeReading } from '../text/readings'
import { payloadTokens } from './payload'

export const BLANK = '___'

const WORD_CHAR = /[\p{L}\p{N}]/u

export function answerRepeatsPrompt(prompt: string, answer: string): boolean {
  if (!answer || !prompt.includes(BLANK)) return false
  const visible = bareText(prompt.replace(BLANK, ''))
  return visible.length > 0 && bareText(answer).includes(visible)
}

export function promptEndsAtBlank(prompt: string): boolean {
  const at = prompt.indexOf(BLANK)
  if (at < 0) return false
  if (WORD_CHAR.test(prompt.slice(at + BLANK.length))) return false
  const before = prompt.slice(0, at).match(/[\p{L}\p{N}]/gu) ?? []
  return before.length < 2
}

export function frontRevealsAnswer(card: { front: string; back: string }): boolean {
  return Boolean(card.back) && bareText(card.front).includes(bareText(card.back))
}

export const label = (lang: string): string => langName(lang)

export const readingsOf = (ctx: ExerciseContext): string[] =>
  Object.values(ctx.card.readings).filter(Boolean)

export const readingsShown = (ctx: ExerciseContext): boolean => ctx.showReadings !== false

export const displayReading = (ctx: ExerciseContext): string =>
  readingsShown(ctx) ? nativeReading(ctx.card) : ''

export const distinctReading = (text: string, reading: string): string =>
  reading && bareText(reading) !== bareText(text) ? reading : ''

export const gradingReading = (ctx: ExerciseContext): string => nativeReading(ctx.card)

const cardTokens = (card: Card): string[] => {
  const tokens = payloadTokens(card)
  return tokens.length >= 2 ? tokens : [card.back]
}

const dictionaryReading = (ctx: ExerciseContext, word: string): string =>
  ctx.readings?.[word] ?? (word === ctx.card.back ? displayReading(ctx) : '')

export const furiganaTokens = (
  ctx: ExerciseContext,
  text: string,
  tokens: readonly string[],
): FuriganaSegment[] | undefined =>
  ctx.card.targetLang === 'ja'
    ? furiganaWords(text, tokens, (word) => ctx.readings?.[word] ?? '')
    : undefined

const cardFurigana = (ctx: ExerciseContext): FuriganaSegment[] | undefined =>
  ctx.card.targetLang === 'ja'
    ? furiganaWords(ctx.card.back, cardTokens(ctx.card), (word) => dictionaryReading(ctx, word))
    : undefined

export const wordView = (ctx: ExerciseContext) => ({
  word: ctx.card.back,
  reading: displayReading(ctx),
  readingLang: ctx.card.targetLang,
  furigana: readingsShown(ctx) ? cardFurigana(ctx) : undefined,
  pitch:
    readingsShown(ctx) && ctx.card.targetLang === 'ja' ? pitchOf(ctx.card.metadata) : undefined,
})

export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
