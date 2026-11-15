/**
 * Guided curriculum (docs/DESIGN.md §13.6, §13.7).
 *
 * A deck is split into lessons; a lesson is finished once every card in it is
 * "learned" (see srs.isLearned). Two flavours, chosen per level:
 *
 *  - themed decks (HSK 1, JLPT N5): fixed 8-card chunks with hand-written titles;
 *  - the frequency path (`zhfreq`): built dynamically off the word list — each
 *    step introduces exactly **one** new word (strict n+1), titled by its content.
 */

export interface LessonPlan {
  title: string
  description: string
}

/** The minimum the builder needs from a card. */
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
  /** the new word this step introduces (frequency path) */
  newWord?: string
  /** pinyin for the new word */
  reading?: string
}

/** Cards introduced per themed lesson. */
export const LESSON_SIZE = 8
/** The frequency path introduces a single new word per step (n+1). */
export const STEP_SIZE = 1

const PLANS: Record<string, LessonPlan[]> = {
  hsk1: [
    { title: 'Greetings', description: 'Hello, thanks, polite basics' },
    { title: 'People', description: 'I, you, he, she, we, names' },
    { title: 'Home & school', description: 'Family, friends, teacher, student' },
    { title: 'Food & drink', description: 'Water, tea, rice, eat, drink' },
    { title: 'Daily verbs', description: 'See, listen, speak, read, write, buy' },
    { title: 'Time', description: 'Today, tomorrow, now, morning, month, week' },
    { title: 'Numbers & things', description: 'One, two, three, ten, book, computer' },
    { title: 'Describing', description: 'Big, small, hot, cold, like, love' },
  ],
  n5: [
    { title: 'Greetings', description: 'Hello, thanks, good morning/evening' },
    { title: 'People', description: 'I, you, person, teacher, student, friend' },
    { title: 'Food & drink', description: 'Water, tea, rice, eat, drink' },
    { title: 'Daily verbs', description: 'See, listen, speak, read, write, buy' },
    { title: 'Time', description: 'Today, tomorrow, now, morning, night, time' },
    { title: 'Places', description: 'School, house, train, car, go, come' },
    { title: 'Nature & things', description: 'Dog, cat, flower, mountain, river, book' },
    { title: 'Describing', description: 'Big, small, new, old, hot, cold, like' },
  ],
}

/** Whether a level uses the dynamic one-word-per-step (n+1) path. */
export function isFrequencyLevel(level: string): boolean {
  return !PLANS[level]
}

/** Splits a deck's cards (in syllabus order) into lessons for its level. */
export function buildLessons(level: string, cards: StepCard[]): Lesson[] {
  const plans = PLANS[level]
  const size = plans ? LESSON_SIZE : STEP_SIZE
  const lessons: Lesson[] = []
  for (let i = 0; i * size < cards.length; i++) {
    const slice = cards.slice(i * size, (i + 1) * size)
    const plan = plans?.[i]
    const first = slice[0]
    lessons.push({
      id: `${level}:${i + 1}`,
      index: i,
      title: plan?.title ?? (size === 1 && first ? first.back : `Lesson ${i + 1}`),
      description:
        plan?.description ??
        (size === 1 && first
          ? [first.front, first.reading].filter(Boolean).join(' · ')
          : `${slice.length} new cards`),
      level,
      cardIds: slice.map((c) => c.id),
      newWord: size === 1 ? first?.back : undefined,
      reading: size === 1 ? first?.reading : undefined,
    })
  }
  return lessons
}
