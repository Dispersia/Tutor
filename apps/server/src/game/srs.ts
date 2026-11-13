/**
 * Spaced repetition (docs/DESIGN.md §13.6).
 *
 * A compact SM-2 variant: each card carries an ease factor and an interval, and
 * the review score maps to a 0..5 quality. Pure functions so the scheduler is
 * unit-tested independently of the database.
 */

export interface SrsState {
  reps: number
  lapses: number
  ease: number
  intervalDays: number
  dueAt: number
  lastReviewAt: number | null
}

export const NEW_SRS: SrsState = {
  reps: 0,
  lapses: 0,
  ease: 2.5,
  intervalDays: 0,
  dueAt: 0,
  lastReviewAt: null,
}

const DAY_MS = 24 * 60 * 60 * 1000
/** How soon a failed card comes back (relearn today). */
export const RELEARN_MS = 10 * 60 * 1000

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Maps a 0..100 exercise score to an SM-2 quality (0..5). */
export function qualityFromScore(score: number, correct: boolean): number {
  if (!correct) return score >= 60 ? 2 : score >= 40 ? 1 : 0
  if (score >= 90) return 5
  if (score >= 75) return 4
  return 3
}

/** Returns the next SRS state for a review at time `now`. */
export function schedule(prev: SrsState, quality: number, now: number): SrsState {
  if (quality < 3) {
    return {
      reps: 0,
      lapses: prev.lapses + 1,
      ease: clamp(prev.ease - 0.2, 1.3, 2.8),
      intervalDays: 0,
      dueAt: now + RELEARN_MS,
      lastReviewAt: now,
    }
  }
  const reps = prev.reps + 1
  let intervalDays: number
  if (reps === 1) intervalDays = 1
  else if (reps === 2) intervalDays = 6
  else intervalDays = Math.round(Math.max(1, prev.intervalDays) * prev.ease)
  const ease = clamp(prev.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)), 1.3, 2.8)
  return {
    reps,
    lapses: prev.lapses,
    ease,
    intervalDays,
    dueAt: now + intervalDays * DAY_MS,
    lastReviewAt: now,
  }
}

export function isDue(state: SrsState, now: number): boolean {
  return state.dueAt <= now
}

/** A card is "learned" once it has survived a couple of spaced reviews. */
export const LEARNED_REPS = 2
export function isLearned(state: SrsState | undefined): boolean {
  return (state?.reps ?? 0) >= LEARNED_REPS
}

/**
 * Picks the card to study next: overdue first, then new, then the soonest due.
 * `cards` is in syllabus order; `srs` maps card id -> state.
 */
export function selectCardId(
  cardIds: string[],
  srs: Map<string, SrsState>,
  now: number,
): string | undefined {
  if (cardIds.length === 0) return undefined
  const due = cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  })
  if (due.length) return due.sort((a, b) => (srs.get(a)!.dueAt ?? 0) - (srs.get(b)!.dueAt ?? 0))[0]
  const fresh = cardIds.filter((id) => !srs.has(id))
  if (fresh.length) return fresh[0]
  return cardIds.slice().sort((a, b) => (srs.get(a)?.dueAt ?? 0) - (srs.get(b)?.dueAt ?? 0))[0]
}

export function countDue(cardIds: string[], srs: Map<string, SrsState>, now: number): number {
  return cardIds.filter((id) => {
    const s = srs.get(id)
    return s ? isDue(s, now) : false
  }).length
}

export function countNew(cardIds: string[], srs: Map<string, SrsState>): number {
  return cardIds.filter((id) => !srs.has(id)).length
}
