/**
 * The shared exercise context, assembled once. Practice's three surfaces and
 * combat all hand an `ExerciseContext` to an exercise definition; this is the one place that builds it, so a new
 * field (readings, known, distractors) is added once.
 */

import type { Card, ExerciseContext } from '@tutor/core'
import type { Deps } from '../../context'
import { getDeck, otherBacks } from '../../db/repo'
import { readStudyPrefs, showsReadings, type StudyPrefs } from '../../services/study'
import { learnerOf, readingMap, type SessionUser } from './select'

export { learnerOf, type SessionUser }

/**
 * Whether to show native readings for a card. A deck-level override (set when
 * the deck was generated) wins over the learner's global study preference.
 */
export function showReadingsFor(
  deps: Deps,
  userId: string,
  card: Card,
  prefs: StudyPrefs,
): boolean {
  const deck = card.deckId ? getDeck(deps.db, card.deckId, userId) : undefined
  return deck?.settings?.showReadings ?? showsReadings(prefs, card.targetLang)
}

export interface ExerciseCtxOpts {
  /** the words the learner knows (the card itself is appended) */
  known: Set<string>
  /** a pre-loaded study-prefs row, when the handler already read it */
  prefs?: StudyPrefs
  /** cards to build the reading map from (defaults to every card) */
  cardPool?: Card[]
  /** a looser "met" set for first-exposure n+1 examples */
  seen?: string[]
  /** how many same-language distractors to fetch for choice exercises */
  distractors?: number
}

/** Assembles the context every exercise definition reads (docs/DESIGN.md §11.2). */
export function exerciseCtx(
  deps: Deps,
  user: SessionUser,
  card: Card,
  opts: ExerciseCtxOpts,
): ExerciseContext {
  const prefs = opts.prefs ?? readStudyPrefs(deps.db, user.id)
  return {
    card,
    learner: learnerOf(user),
    distractors: opts.distractors
      ? otherBacks(deps.db, user.id, card.targetLang, card.back, opts.distractors)
      : [],
    readings: readingMap(deps.db, user.id, card.targetLang, opts.cardPool),
    known: [...opts.known, card.back],
    seen: opts.seen ? [...opts.seen, card.back] : undefined,
    showReadings: showReadingsFor(deps, user.id, card, prefs),
  }
}
