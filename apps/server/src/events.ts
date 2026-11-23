/**
 * Domain event bus (docs/DESIGN.md §11.4). Game systems subscribe to these events
 * so new mechanics (achievements, quests, leagues) are additive — they never have
 * to touch the exercise engine.
 *
 * Events are facts about committed writes: an `emit` inside a transaction
 * (`inTransaction`/`atomic`, which run under `deferEvents`) is held until the
 * outermost transaction commits, and dropped if it rolls back.
 */

import type { UserId, CardId, GearInstanceId } from './ids'
import type { CardState, Rating } from './game/srs'
import type { Cost } from './game/skills'

export interface GameEventMap {
  'review.completed': {
    userId: UserId
    cardId: CardId
    exerciseId: string
    score: number
    correct: boolean
  }
  'xp.awarded': { userId: UserId; amount: number; reason: string; total: number }
  'level.up': { userId: UserId; level: number }
  'streak.updated': { userId: UserId; days: number }
  'skill.xp': {
    userId: UserId
    actionId: string
    skillId: string
    amount: number
    xp: number
    level: number
  }
  'skill.level.up': { userId: UserId; actionId: string; skillId: string; level: number }
  'item.gained': { userId: UserId; itemId: string; count: number; total?: number }
  'item.consumed': { userId: UserId; itemId: string; count: number; total?: number }
  /** idle rigs settled (docs/DESIGN.md §13.5.1): everything the runs made and spent */
  'idle.settled': { userId: UserId; gained: Cost[]; spent: Cost[] }
  'talent.chosen': {
    userId: UserId
    talentId: string
    skillId: string
    milestone: number
    tier: 'choice' | 'mastery'
  }
  'talent.changed': {
    userId: UserId
    talentId: string
    fromTalentId: string
    skillId: string
    milestone: number
    tier: 'choice' | 'mastery'
  }
  'item.equipped': { userId: UserId; itemId: string; slot: string }
  /** A band reagent enchanted a piece (docs §13.5.3). */
  'item.enchanted': { userId: UserId; instanceId: GearInstanceId; band: string }
  'combat.hit': {
    userId: UserId
    monsterId: string
    damage: number
    monsterHp: number
    crit?: boolean
    haste?: boolean
  }
  'combat.ended': { userId: UserId; monsterId: string; outcome: 'won' | 'lost' }
  'srs.updated': {
    userId: UserId
    cardId: CardId
    reps: number
    dueAt: number
    intervalDays: number
    rating: Rating
    state: CardState
  }
  'lesson.completed': { userId: UserId; lessonId: string }
}

export type GameEventType = keyof GameEventMap

type Handler<T extends GameEventType> = (event: GameEventMap[T]) => void

/**
 * One buffer of held deliveries per open `deferEvents` scope, innermost last.
 * Module-level on purpose: transactions are synchronous (no `await` inside),
 * so scopes strictly nest and can never interleave.
 */
const scopes: (() => void)[][] = []

/**
 * Runs `fn` with event delivery held back. When `fn` returns, its events join
 * the enclosing scope (a savepoint inside a transaction) or, for the outermost
 * scope, are delivered in the order they were emitted. When `fn` throws, its
 * events are dropped — the writes they describe were rolled back.
 */
export function deferEvents<T>(fn: () => T): T {
  const held: (() => void)[] = []
  scopes.push(held)
  let out: T
  try {
    out = fn()
  } finally {
    scopes.pop()
  }
  const outer = scopes.at(-1)
  if (outer) outer.push(...held)
  else for (const deliver of held) deliver()
  return out
}

export class EventBus {
  #handlers = new Map<GameEventType, Set<(event: never) => void>>()

  /** Subscribes; returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, fn: Handler<T>): () => void {
    const set = this.#handlers.get(type) ?? new Set()
    set.add(fn as (event: never) => void)
    this.#handlers.set(type, set)
    return () => set.delete(fn as (event: never) => void)
  }

  /** Delivers now, or once the open transaction commits (see `deferEvents`). */
  emit<T extends GameEventType>(type: T, event: GameEventMap[T]): void {
    const held = scopes.at(-1)
    if (held) held.push(() => this.#deliver(type, event))
    else this.#deliver(type, event)
  }

  #deliver<T extends GameEventType>(type: T, event: GameEventMap[T]): void {
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
