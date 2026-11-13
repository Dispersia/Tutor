/**
 * Guided curriculum (docs/DESIGN.md §13.6).
 *
 * A deck is split into small themed lessons; a lesson is finished once every card
 * in it is "learned" (see srs.isLearned). Lessons are derived from the deck's
 * cards in syllabus order, so adding cards extends the path automatically.
 */

export interface LessonPlan {
  title: string
  description: string
}

export interface Lesson {
  id: string
  index: number
  title: string
  description: string
  level: string
  cardIds: string[]
}

/** Cards introduced per lesson. */
export const LESSON_SIZE = 8

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

/** Splits a deck's cards (in order) into lessons for its level. */
export function buildLessons(level: string, cardIds: string[]): Lesson[] {
  const plans = PLANS[level] ?? []
  const lessons: Lesson[] = []
  for (let i = 0; i * LESSON_SIZE < cardIds.length; i++) {
    const plan = plans[i]
    lessons.push({
      id: `${level}:${i + 1}`,
      index: i,
      title: plan?.title ?? `Lesson ${i + 1}`,
      description: plan?.description ?? `${LESSON_SIZE} new cards`,
      level,
      cardIds: cardIds.slice(i * LESSON_SIZE, (i + 1) * LESSON_SIZE),
    })
  }
  return lessons
}
