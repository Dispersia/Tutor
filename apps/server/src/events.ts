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

const scopes: (() => void)[][] = []

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

  on<T extends GameEventType>(type: T, fn: Handler<T>): () => void {
    const set = this.#handlers.get(type) ?? new Set()
    set.add(fn as (event: never) => void)
    this.#handlers.set(type, set)
    return () => set.delete(fn as (event: never) => void)
  }

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
