import type { UserId, DeckId, CardId } from '../../ids'
import type { ServerCard } from '../../db/repo'
import type { Card, ExerciseContext, ExerciseDef, Learner } from '@tutor/core'
import type { Deps } from '../../context'
import {
  cardsGradedSince,
  getCard,
  getDeck,
  lastExerciseUse,
  listCards,
  listDecks,
} from '../../db/repo'
import { INTRODUCE_ID, registry } from '../../exercises'
import { buildLessons } from '../../game/curriculum'
import { selectCardId, type FsrsState } from '../../game/srs'
import { displayReading } from '../../text/readings'
import { lessonCardsOf, parseLessonId } from '../../services/curriculum'
import { readStudyPrefs, type StudyPrefs } from '../../services/study'
import { srsStateMap, type LoadedCards } from '../../services/srs'

export interface SessionUser {
  id: UserId
  nativeLang: string
  level: string | null
}

export function learnerOf(user: SessionUser, targetLang: string): Learner {
  return {
    id: user.id,
    nativeLang: user.nativeLang,
    targetLang,
    level: user.level ?? 'hsk1',
  }
}

export function studyDeckId(deps: Deps, userId: UserId, prefs?: StudyPrefs): DeckId | undefined {
  const decks = listDecks(deps.db, userId)
  const activeId = (prefs ?? readStudyPrefs(deps.db, userId)).activeDeckId
  const active = activeId ? decks.find((d) => d.id === activeId) : undefined
  return (active ?? decks[0])?.id
}

const SITTING_GAP_MS = 30 * 60_000

const WARMUP_NEW_CARDS = 3

export function pickStudyCard(
  deps: Deps,
  userId: UserId,
  ids: CardId[],
  srs: Map<CardId, FsrsState>,
): ServerCard | undefined {
  const now = Date.now()

  if (cardsGradedSince(deps.db, userId, now - SITTING_GAP_MS) < WARMUP_NEW_CARDS) {
    const id = ids.find((id) => !srs.has(id))
    if (id) return getCard(deps.db, id, userId)
  }

  const id = selectCardId(ids, srs, now)
  return id ? getCard(deps.db, id, userId) : undefined
}

export function lessonOfCard(deps: Deps, userId: UserId, card: ServerCard): string | undefined {
  if (!card.deckId) return undefined
  const deck = getDeck(deps.db, card.deckId)
  if (!deck) return undefined
  const key = deck.id
  const lessons = buildLessons(key, lessonCardsOf(listCards(deps.db, userId, deck.id)))
  return lessons.find((l) => l.cardIds.includes(card.id))?.id
}

export function pickReviewCard(
  deps: Deps,
  userId: UserId,
  deckId?: DeckId,
  loaded?: LoadedCards,
): ServerCard | undefined {
  const srs = loaded?.srs ?? srsStateMap(deps.db, userId)
  const cards = loaded
    ? loaded.cards.filter((c) => !deckId || c.deckId === deckId)
    : listCards(deps.db, userId, deckId)
  const ids = cards.filter((c) => srs.has(c.id)).map((c) => c.id)
  if (ids.length === 0) return undefined
  const id = selectCardId(ids, srs, Date.now(), 'combat')
  return id ? getCard(deps.db, id, userId) : undefined
}

export function readingMap(
  db: Deps['db'],
  userId: UserId,
  targetLang: string,
  cards?: Card[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of cards ?? listCards(db, userId)) {
    if (c.targetLang !== targetLang) continue
    map[c.back] = displayReading(c)
  }
  return map
}

export function resolveLesson(
  deps: Deps,
  userId: UserId,
  lessonId: string,
): { deckId: DeckId; cardIds: CardId[]; key: string } | undefined {
  const parts = parseLessonId(lessonId)
  if (!parts) return undefined
  const deck = listDecks(deps.db, userId).find((d) => d.id === parts.key)
  if (!deck) return undefined
  const cards = listCards(deps.db, userId, deck.id)
  const lesson = buildLessons(parts.key, lessonCardsOf(cards))[parts.index]
  if (!lesson) return undefined
  return { deckId: deck.id, cardIds: lesson.cardIds, key: parts.key }
}

export interface DrillPickOpts {
  ctx?: ExerciseContext
  quiet?: boolean
  disabled?: ReadonlySet<string>
}

export function pickNextExercise(
  db: Parameters<typeof lastExerciseUse>[0],
  userId: UserId,
  card: Card,
  learner: Learner,
  opts: DrillPickOpts = {},
): ExerciseDef<unknown> | undefined {
  const pool = eligibleDrills(card, learner, opts)
  if (pool.length === 0) return undefined
  if (pool.length === 1) return pool[0]
  return leastRecentlyUsed(db, userId, pool)
}

function eligibleDrills(card: Card, learner: Learner, opts: DrillPickOpts): ExerciseDef<unknown>[] {
  let all = registry
    .forCard(card, learner)
    .filter((d) => d.id !== INTRODUCE_ID && !d.temporarilyDisabled)
  if (opts.disabled?.size) all = all.filter((d) => !opts.disabled!.has(d.id))
  if (opts.quiet) all = all.filter((d) => d.modality !== 'voice')
  const eligible = opts.ctx ? all.filter((d) => !d.available || d.available(opts.ctx!)) : all
  return eligible.length > 0 ? eligible : all
}

function leastRecentlyUsed(
  db: Parameters<typeof lastExerciseUse>[0],
  userId: UserId,
  pool: ExerciseDef<unknown>[],
): ExerciseDef<unknown> {
  const lastUse = lastExerciseUse(db, userId)
  const oldest = Math.min(...pool.map((d) => lastUse.get(d.id) ?? 0))
  const ties = pool.filter((d) => (lastUse.get(d.id) ?? 0) === oldest)
  return ties[Math.floor(Math.random() * ties.length)]!
}

export function noDrillMessage(disabled: ReadonlySet<string>): string {
  return disabled.size
    ? 'Every exercise kind for this card is turned off — re-enable some in Settings › Study.'
    : 'No exercise available for this card.'
}
