/** The guided path: decks split into lessons, and lesson completion (docs/DESIGN.md §13.6). */

import { completeLesson, deckKey, listCards, listDecks, listLessonProgress } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { buildLessons } from '../game/curriculum'
import { countDue, isLearned } from '../game/srs'
import { publicDeckSettings } from '../deck/settings'
import { pinyinToZhuyin } from '../seed/zhuyin'
import { srsStateMap } from './srs'

/** The guided path: each deck split into lessons with completion state. */
export function curriculumView(db: Db, userId: string) {
  const decks = listDecks(db, userId)
  const srsMap = srsStateMap(db, userId)
  const completed = new Set(listLessonProgress(db, userId).map((r) => r.lessonId))
  const now = Date.now()

  return decks.map((d) => {
    const cards = listCards(db, userId, d.id)
    const ids = cards.map((c) => c.id)
    const lessons = buildLessons(deckKey(d), lessonCardsOf(cards)).map((l) => {
      const learned = l.cardIds.filter((id) => isLearned(srsMap.get(id))).length
      const due = countDue(l.cardIds, srsMap, now)
      return {
        ...l,
        cards: l.cardIds.length,
        learned,
        due,
        complete: completed.has(l.id) || (l.cardIds.length > 0 && learned >= l.cardIds.length),
      }
    })
    return {
      deckId: d.id,
      name: d.name,
      level: d.level,
      targetLang: d.targetLang,
      description: d.description,
      settings: publicDeckSettings(d.settings),
      // How many source words are still unbuilt (an interrupted import), so the
      // UI can offer to finish it. Undefined when the deck has no stored list.
      remaining: d.settings.words
        ? Math.max(0, d.settings.words.length - (d.settings.cursor ?? 0))
        : undefined,
      cardCount: Number(d.cardCount),
      learned: ids.filter((id) => isLearned(srsMap.get(id))).length,
      due: countDue(ids, srsMap, now),
      lessons,
    }
  })
}

/** Maps stored cards to the shape the curriculum builder needs. */
function lessonCardsOf(cards: ReturnType<typeof listCards>) {
  return cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    reading: cardDisplayReading(c),
    step: typeof c.payload?.step === 'number' ? c.payload.step : undefined,
  }))
}

/** The reading a learner sees: Zhuyin for Chinese, kana for Japanese. */
function cardDisplayReading(c: { targetLang: string; readings: Record<string, string> }): string {
  const r = c.readings
  if (c.targetLang === 'ja') return r.kana || ''
  if (c.targetLang === 'zh') return r.zhuyin || (r.pinyin ? pinyinToZhuyin(r.pinyin) : '')
  return Object.values(r).find(Boolean) ?? ''
}

/** Marks a lesson complete when every card in it has been learned. */
export function checkLessonCompletion(
  db: Db,
  bus: EventBus,
  userId: string,
  lessonId: string,
): boolean {
  const sep = lessonId.lastIndexOf(':')
  if (sep <= 0) return false
  const key = lessonId.slice(0, sep)
  const index = Number(lessonId.slice(sep + 1)) - 1
  if (!key || !Number.isFinite(index) || index < 0) return false
  const deck = listDecks(db, userId).find((d) => d.level === key || d.id === key)
  if (!deck) return false
  const cards = listCards(db, userId, deck.id)
  const lesson = buildLessons(key, lessonCardsOf(cards))[index]
  if (!lesson || lesson.cardIds.length === 0) return false
  const srsMap = srsStateMap(db, userId)
  const done = lesson.cardIds.every((id) => isLearned(srsMap.get(id)))
  if (!done) return false
  // Only a transition counts: reviewing a lesson that was finished days ago is
  // not "lesson complete" again (the practice queue interleaves steps now).
  const known = listLessonProgress(db, userId).some((p) => p.lessonId === lessonId)
  if (known) return false
  completeLesson(db, userId, lessonId)
  bus.emit('lesson.completed', { userId, lessonId })
  return true
}
