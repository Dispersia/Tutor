/**
 * Guided curriculum (docs/DESIGN.md §13.6, §13.7).
 *
 * Every course is the frequency path: a deck is split into one-word steps
 * (strict n+1), each titled by the word it introduces. A step is finished once
 * its card is "learned" (see srs.isLearned).
 */

export interface StepCard {
  id: string
  front: string
  back: string
  reading?: string
}

export interface Lesson {
  id: string
  index: number
  title: string
  description: string
  level: string
  cardIds: string[]
  /** the new word this step introduces */
  newWord?: string
  /** native reading (Zhuyin / kana) for the new word */
  reading?: string
}

/** The frequency path introduces a single new word per step (n+1). */
export const STEP_SIZE = 1

/** Splits a deck's cards (in syllabus order) into one-word steps. */
export function buildLessons(level: string, cards: StepCard[]): Lesson[] {
  return cards.map((card, i) => ({
    id: `${level}:${i + 1}`,
    index: i,
    title: card.back,
    description: [card.front, card.reading].filter(Boolean).join(' · '),
    level,
    cardIds: [card.id],
    newWord: card.back,
    reading: card.reading,
  }))
}
