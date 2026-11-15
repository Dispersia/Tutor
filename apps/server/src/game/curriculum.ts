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
  /**
   * The n+1 step this card belongs to. Cards sharing a step (a word and the
   * example/grammar cards built from it) form one lesson. Undefined → one card
   * per lesson (the curated path's behaviour).
   */
  step?: number
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

/**
 * Splits a deck's cards (in syllabus order) into n+1 steps. Cards tagged with
 * the same `step` are grouped into one lesson; without a tag each card is its
 * own step. `key` is the deck's level (curated) or id (generated).
 */
export function buildLessons(key: string, cards: StepCard[]): Lesson[] {
  const groups: StepCard[][] = []
  let current: number | undefined
  for (const card of cards) {
    if (card.step !== undefined && card.step === current && groups.length > 0) {
      groups[groups.length - 1]!.push(card)
    } else {
      groups.push([card])
      current = card.step
    }
  }
  return groups.map((group, i) => {
    const head = group[0]!
    return {
      id: `${key}:${i + 1}`,
      index: i,
      title: head.back,
      description: [head.front, head.reading].filter(Boolean).join(' · '),
      level: key,
      cardIds: group.map((c) => c.id),
      newWord: head.back,
      reading: head.reading,
    }
  })
}
