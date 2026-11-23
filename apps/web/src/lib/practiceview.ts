/**
 * Pure derivations for the practice screen: labels for the header and results,
 * the next lesson on the path, and the "quiet mode" countdown. No runes, no DOM.
 */

import type { CurriculumDeck, LessonDTO } from './curriculum'
import type { SrsOutcome } from './exercises'

const RATING_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as const

/** Short label for the lesson header (the frequency path reads as "Frequency"). */
export function lessonLabel(l: LessonDTO): string {
  if (l.level === 'zhfreq' || l.level === 'jafreq') return 'Frequency'
  // generated decks address their lessons by deck id; show a plain label
  return l.level.length > 12 ? 'Deck' : l.level.toUpperCase()
}

/** Human summary of the FSRS-6 scheduling decision. */
export function reviewLabel(s: SrsOutcome, now: number = Date.now()): string {
  const rating = RATING_NAMES[s.rating]
  if (s.state === 'learning' || s.state === 'relearning') {
    const mins = Math.max(1, Math.round((s.dueAt - now) / 60_000))
    return `${rating} · again in ${mins} min`
  }
  const d = s.intervalDays
  return `${rating} · next in ${d} day${d === 1 ? '' : 's'}`
}

/** The next step of the path: the first unfinished lesson after this one. */
export function nextLessonAfter(curriculum: CurriculumDeck[], id: string): string | undefined {
  const deck = curriculum.find((d) => d.lessons.some((l) => l.id === id))
  if (!deck) return undefined
  const idx = deck.lessons.findIndex((l) => l.id === id)
  if (idx < 0) return undefined
  return deck.lessons.slice(idx + 1).find((l) => !l.complete)?.id
}

/** mm:ss remaining in the "can't speak or listen" window. */
export function quietClock(until: number, now: number): string {
  const s = Math.max(0, Math.ceil((until - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
