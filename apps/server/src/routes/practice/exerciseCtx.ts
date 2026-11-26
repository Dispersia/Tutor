import type { UserId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { Card, ExerciseContext } from '@tutor/core'
import type { Deps } from '../../context'
import { getDeck, otherBacks } from '../../db/repo'
import { isUtterance } from '../../exercises/payload'
import type { ScriptPrefs } from '../../llm/prompts'
import { readStudyPrefs, showsReadings, type StudyPrefs } from '../../services/study'
import { learnerOf, readingMap, type SessionUser } from './select'

export { learnerOf, type SessionUser }

export function scriptPrefsFor(deps: Deps, card: ServerCard): ScriptPrefs {
  const deck = card.deckId ? getDeck(deps.db, card.deckId) : undefined
  return { variant: deck?.settings?.variant, readingScript: deck?.settings?.readingScript }
}

function showReadingsFor(deps: Deps, userId: UserId, card: ServerCard, prefs: StudyPrefs): boolean {
  const deck = card.deckId ? getDeck(deps.db, card.deckId) : undefined
  return deck?.settings?.showReadings ?? showsReadings(prefs, card.targetLang)
}

export interface ExerciseCtxOpts {
  known: Set<string>
  prefs?: StudyPrefs
  cardPool?: Card[]
  readings?: Record<string, string>
  seen?: string[]
  distractors?: number
}

export function exerciseCtx(
  deps: Deps,
  user: SessionUser,
  card: ServerCard,
  opts: ExerciseCtxOpts,
): ExerciseContext {
  const prefs = opts.prefs ?? readStudyPrefs(deps.db, user.id)
  return {
    card,
    learner: learnerOf(user, card.targetLang),
    distractors: opts.distractors
      ? otherBacks(deps.db, user.id, card.targetLang, card.back, opts.distractors)
      : [],
    readings: opts.readings ?? readingMap(deps.db, user.id, card.targetLang, opts.cardPool),
    known: [...opts.known, card.back],
    seen: opts.seen ? [...opts.seen, card.back] : undefined,
    utterances: utteranceBacks(opts.cardPool, card.targetLang),
    showReadings: showReadingsFor(deps, user.id, card, prefs),
  }
}

function utteranceBacks(cards: Card[] | undefined, lang: string): string[] {
  return (cards ?? []).filter((c) => c.targetLang === lang && isUtterance(c)).map((c) => c.back)
}
