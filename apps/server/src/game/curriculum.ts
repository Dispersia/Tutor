export interface StepCard<I extends string = string> {
  id: I
  front: string
  back: string
  reading?: string
  step?: number
}

export interface Lesson<I extends string = string> {
  id: string
  index: number
  title: string
  description: string
  level: string
  cardIds: I[]
  newWord?: string
  reading?: string
}

export const STEP_SIZE = 1

export function buildLessons<I extends string>(key: string, cards: StepCard<I>[]): Lesson<I>[] {
  return groupByStep(cards).map((group, i) => lessonOf(key, group, i))
}

function groupByStep<I extends string>(cards: StepCard<I>[]): StepCard<I>[][] {
  const groups: StepCard<I>[][] = []
  const index = new Map<number, number>()
  for (const card of cards) {
    if (card.step === undefined) {
      groups.push([card])
      continue
    }
    const existing = index.get(card.step)
    if (existing !== undefined) groups[existing]!.push(card)
    else {
      index.set(card.step, groups.length)
      groups.push([card])
    }
  }
  return groups
}

function lessonOf<I extends string>(key: string, group: StepCard<I>[], i: number): Lesson<I> {
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
}
