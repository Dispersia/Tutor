/**
 * Card selection for practice (docs/DESIGN.md §13.6, §13.7).
 *
 * These are the pure-ish selectors behind the practice and combat drills: which
 * card to serve, which curriculum step it belongs to, and which exercise kind is
 * least recently trained. They read the database but write nothing and know
 * nothing about HTTP, so both route modules share them.
 */

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
import { selectCardId, selectStudyCardId, type FsrsState } from '../../game/srs'
import { displayReading } from '../../text/readings'
import { srsStateMap } from '../../services/srs'

/** The user fields a route handler has on `c.get('user')` (docs/DESIGN §12.5). */
export interface SessionUser {
  id: UserId
  nativeLang: string
  targetLang: string | null
  level: string | null
}

/** A `Learner` from the session user, with the same defaults every route uses. */
export function learnerOf(user: SessionUser): Learner {
  return {
    id: user.id,
    nativeLang: user.nativeLang,
    targetLang: user.targetLang ?? 'zh',
    level: user.level ?? 'hsk1',
  }
}

/** A pause this long starts a new sitting (and warms up again). */
const SITTING_GAP_MS = 30 * 60_000

/**
 * How many new words open a practice sitting before the due backlog. A session
 * that starts on a long row of reviews feels like grinding; meeting a few new
 * words first keeps the session about learning, then the reviews follow.
 */
const WARMUP_NEW_CARDS = 3

/**
 * Card selection for practice: due-first spaced repetition over the deck, except
 * that a sitting opens on a few new words before the due backlog. A card that is
 * not due is never preferred over a new word, so a word is not re-shown
 * back-to-back just because it is the only one the learner has met. Unlike
 * combat's `pickReviewCard`, practice never serves a review card ahead of its
 * due date — that card's same-day review does not move the due date, so it would
 * come straight back again (and again).
 */
export function pickStudyCard(
  deps: Deps,
  userId: UserId,
  ids: CardId[],
  srs: Map<CardId, FsrsState>,
): ServerCard | undefined {
  const now = Date.now()

  // A sitting opens with a few new words (in curriculum order), then the due
  // backlog takes over. Reviews never lose their place: the warm-up only runs
  // while the sitting is young, and only when a new card is available.
  if (cardsGradedSince(deps.db, userId, now - SITTING_GAP_MS) < WARMUP_NEW_CARDS) {
    const id = ids.find((id) => !srs.has(id))
    if (id) return getCard(deps.db, id, userId)
  }

  // Overdue first, then the next new word, then a learning step that is due
  // within the learn-ahead window. Nothing to do -> the day is done.
  const id = selectStudyCardId(ids, srs, now)
  return id ? getCard(deps.db, id, userId) : undefined
}

/** The curriculum step a card belongs to, so the practice header can follow it. */
export function lessonOfCard(deps: Deps, userId: UserId, card: ServerCard): string | undefined {
  if (!card.deckId) return undefined
  const deck = getDeck(deps.db, card.deckId)
  if (!deck) return undefined
  const key = deck.id
  const lessons = buildLessons(key, stepCardsOf(listCards(deps.db, userId, deck.id)))
  return lessons.find((l) => l.cardIds.includes(card.id))?.id
}

/**
 * Review-only card selection for combat: never a brand-new card. Only cards that
 * already have a spaced-repetition state are eligible (due ones first), so a
 * fight never introduces vocabulary — it practises what you've already met.
 */
export function pickReviewCard(
  deps: Deps,
  userId: UserId,
  deckId?: DeckId,
): ServerCard | undefined {
  const srs = srsStateMap(deps.db, userId)
  const ids = listCards(deps.db, userId, deckId)
    .filter((c) => srs.has(c.id))
    .map((c) => c.id)
  if (ids.length === 0) return undefined
  const id = selectCardId(ids, srs, Date.now())
  return id ? getCard(deps.db, id, userId) : undefined
}

/** Maps stored cards to the curriculum builder's shape. */
export function stepCardsOf<I extends string>(cards: (Card & { id: I })[]) {
  return cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    reading: displayReadingOf(c),
    // Generated decks tag each card with the n+1 step it belongs to, so a word
    // and its example cards share one lesson.
    step: typeof c.payload?.step === 'number' ? c.payload.step : undefined,
  }))
}

/** Native reading for a card: Zhuyin (zh) or kana (ja). Never pinyin/romaji. */
export function displayReadingOf(c: Card): string {
  return displayReading(c)
}

/** Display reading (Zhuyin / kana) keyed by target text, for option annotation. */
export function readingMap(
  db: Deps['db'],
  userId: UserId,
  targetLang: string,
  cards?: Card[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of cards ?? listCards(db, userId)) {
    if (c.targetLang !== targetLang) continue
    map[c.back] = displayReadingOf(c)
  }
  return map
}

/**
 * Resolves a lesson id into its card ids (and its deck). The id is
 * `<deckId>:<index>`. The key is always the deck's id, so two decks never share
 * lesson ids.
 */
export function resolveLesson(
  deps: Deps,
  userId: UserId,
  lessonId: string,
): { deckId: DeckId; cardIds: CardId[]; key: string } | undefined {
  const sep = lessonId.lastIndexOf(':')
  if (sep <= 0) return undefined
  const key = lessonId.slice(0, sep)
  const index = Number(lessonId.slice(sep + 1)) - 1
  if (!key || !Number.isFinite(index) || index < 0) return undefined
  const deck = listDecks(deps.db).find((d) => d.id === key)
  if (!deck) return undefined
  const cards = listCards(deps.db, userId, deck.id)
  const lesson = buildLessons(key, stepCardsOf(cards))[index]
  if (!lesson) return undefined
  return { deckId: deck.id, cardIds: lesson.cardIds, key }
}

/** Knobs the drill rotation reads: the learner gate plus their own switches. */
export interface DrillPickOpts {
  /** the assembled exercise context, for the learner-state gate */
  ctx?: ExerciseContext
  /** quiet mode ("can't speak or listen"): never offer a listen/speak card */
  quiet?: boolean
  /** exercise kinds the learner turned off in Study settings */
  disabled?: ReadonlySet<string>
}

/** "The next drill": the eligible exercise you've trained least recently. */
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

/** The drills that can be offered, after the product, learner and state gates. */
function eligibleDrills(card: Card, learner: Learner, opts: DrillPickOpts): ExerciseDef<unknown>[] {
  let all = registry
    .forCard(card, learner)
    // The first-exposure "teach" step is never part of the drill rotation, and a
    // product-wide off exercise (the pronunciation card) is never offered.
    .filter((d) => d.id !== INTRODUCE_ID && !d.temporarilyDisabled)
  if (opts.disabled?.size) all = all.filter((d) => !opts.disabled!.has(d.id))
  // Quiet mode ("can't speak or listen"): never offer a listen/speak card.
  if (opts.quiet) all = all.filter((d) => d.modality !== 'voice')
  // Learner-state gate (n+1 exercises are only offered once they can be built).
  const eligible = opts.ctx ? all.filter((d) => !d.available || d.available(opts.ctx!)) : all
  return eligible.length > 0 ? eligible : all
}

/** Of an equally-eligible pool, the exercise used least recently (ties random). */
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

/** A helpful message when no drill can be offered for a card. */
export function noDrillMessage(disabled: ReadonlySet<string>): string {
  return disabled.size
    ? 'Every exercise kind for this card is turned off — re-enable some in Settings › Study.'
    : 'No exercise available for this card.'
}
