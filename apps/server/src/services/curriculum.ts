import type { UserId } from '../ids'
import { completeLesson, deckKey, listCards, listDecks, listLessonProgress } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { buildLessons } from '../game/curriculum'
import { countDue, isLearned, type FsrsState } from '../game/srs'
import { publicDeckSettings } from '../deck/settings'
import { lexiconOrder } from '../deck/lexicon'
import { displayReading } from '../text/readings'
import { srsStateMap } from './srs'
import { readStudyPrefs, showsReadings, type StudyPrefs } from './study'

export function curriculumView(db: Db, userId: UserId, now: number = Date.now()) {
  const decks = listDecks(db, userId)
  const srsMap = srsStateMap(db, userId)
  const completed = new Set(listLessonProgress(db, userId).map((r) => r.lessonId))
  const ctx: CurriculumCtx = {
    srsMap,
    completed,
    now,
    prefs: readStudyPrefs(db, userId),
  }
  return decks.map((d) => deckView(db, userId, d, ctx))
}

interface CurriculumCtx {
  srsMap: Map<string, FsrsState>
  completed: Set<string>
  now: number
  prefs: StudyPrefs
}

type DeckRow = ReturnType<typeof listDecks>[number]
type LessonRow = ReturnType<typeof buildLessons>[number]

function deckView(db: Db, userId: UserId, d: DeckRow, ctx: CurriculumCtx) {
  const cards = listCards(db, userId, d.id)
  const ids = cards.map((c) => c.id)
  const showReadings = d.settings.showReadings ?? showsReadings(ctx.prefs, d.targetLang)
  return {
    deckId: d.id,
    name: d.name,
    level: d.level,
    targetLang: d.targetLang,
    description: d.description,
    settings: publicDeckSettings(d.settings),
    remaining: remainingWords(d),
    cardCount: Number(d.cardCount),
    learned: ids.filter((id) => isLearned(ctx.srsMap.get(id))).length,
    due: countDue(ids, ctx.srsMap, ctx.now),
    lessons: buildLessons(deckKey(d), lessonCardsOf(cards, showReadings)).map((l) =>
      lessonView(l, ctx),
    ),
  }
}

function lessonView(l: LessonRow, ctx: CurriculumCtx) {
  const learned = l.cardIds.filter((id) => isLearned(ctx.srsMap.get(id))).length
  return {
    ...l,
    cards: l.cardIds.length,
    learned,
    due: countDue(l.cardIds, ctx.srsMap, ctx.now),
    complete: ctx.completed.has(l.id) || (l.cardIds.length > 0 && learned >= l.cardIds.length),
  }
}

function remainingWords(d: DeckRow): number | undefined {
  const words = d.settings.words ?? lexiconOrder(d.targetLang)
  if (!words) return undefined
  return Math.max(0, words.length - (d.settings.cursor ?? 0))
}

export function lessonCardsOf(cards: ReturnType<typeof listCards>, showReadings = true) {
  return cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    reading: showReadings ? cardDisplayReading(c) : '',
    step: typeof c.payload?.step === 'number' ? c.payload.step : undefined,
  }))
}

function cardDisplayReading(c: { targetLang: string; readings: Record<string, string> }): string {
  return displayReading(c)
}

export function checkLessonCompletion(
  db: Db,
  bus: EventBus,
  userId: UserId,
  lessonId: string,
): boolean {
  const parts = parseLessonId(lessonId)
  if (!parts) return false
  const deck = listDecks(db, userId).find((d) => d.id === parts.key)
  if (!deck) return false
  const lesson = buildLessons(parts.key, lessonCardsOf(listCards(db, userId, deck.id)))[parts.index]
  if (!lesson || lesson.cardIds.length === 0) return false
  const srsMap = srsStateMap(db, userId)
  if (!lesson.cardIds.every((id) => isLearned(srsMap.get(id)))) return false
  if (listLessonProgress(db, userId).some((p) => p.lessonId === lessonId)) return false
  completeLesson(db, userId, lessonId)
  bus.emit('lesson.completed', { userId, lessonId })
  return true
}

export function parseLessonId(lessonId: string): { key: string; index: number } | undefined {
  const sep = lessonId.lastIndexOf(':')
  if (sep <= 0) return undefined
  const key = lessonId.slice(0, sep)
  const index = Number(lessonId.slice(sep + 1)) - 1
  if (!key || !Number.isFinite(index) || index < 0) return undefined
  return { key, index }
}
