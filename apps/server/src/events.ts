/**
 * Domain event bus (docs/DESIGN.md §11.4). Game systems subscribe to these events
 * so new mechanics (achievements, quests, leagues) are additive — they never have
 * to touch the exercise engine.
 */

import type { CardState, Rating } from './game/srs'

export interface GameEventMap {
  'review.completed': {
    userId: string
    cardId: string
    exerciseId: string
    score: number
    correct: boolean
  }
  'xp.awarded': { userId: string; amount: number; reason: string; total: number }
  'level.up': { userId: string; level: number }
  'streak.updated': { userId: string; days: number }
  'skill.xp': {
    userId: string
    actionId: string
    skillId: string
    amount: number
    xp: number
    level: number
  }
  'skill.level.up': { userId: string; actionId: string; skillId: string; level: number }
  'item.gained': { userId: string; itemId: string; count: number; total: number }
  'item.consumed': { userId: string; itemId: string; count: number; total: number }
  'talent.chosen': {
    userId: string
    talentId: string
    skillId: string
    milestone: number
  }
  'talent.changed': {
    userId: string
    talentId: string
    fromTalentId: string
    skillId: string
    milestone: number
  }
  'item.equipped': { userId: string; itemId: string; slot: string }
  'combat.hit': { userId: string; monsterId: string; damage: number; monsterHp: number }
  'combat.ended': { userId: string; monsterId: string; outcome: 'won' | 'lost' }
  'srs.updated': {
    userId: string
    cardId: string
    reps: number
    dueAt: number
    intervalDays: number
    rating: Rating
    state: CardState
  }
  'lesson.completed': { userId: string; lessonId: string }
}

export type GameEventType = keyof GameEventMap

type Handler<T extends GameEventType> = (event: GameEventMap[T]) => void

export class EventBus {
  #handlers = new Map<GameEventType, Set<(event: never) => void>>()

  /** Subscribes; returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, fn: Handler<T>): () => void {
    const set = this.#handlers.get(type) ?? new Set()
    set.add(fn as (event: never) => void)
    this.#handlers.set(type, set)
    return () => set.delete(fn as (event: never) => void)
  }

  emit<T extends GameEventType>(type: T, event: GameEventMap[T]): void {
    for (const fn of this.#handlers.get(type) ?? []) {
      try {
        ;(fn as unknown as Handler<T>)(event)
      } catch (err) {
        console.error(`[events] ${type} handler failed`, err)
      }
    }
  }

  handlerCount(type: GameEventType): number {
    return this.#handlers.get(type)?.size ?? 0
  }
}
