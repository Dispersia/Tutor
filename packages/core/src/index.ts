import type { Card, ExerciseDef, Learner } from './types'

export * from './types'
export * from './templates'
export * from './metadata'
export * from './idle'
export * from './voice'

export class ExerciseRegistry {
  #defs = new Map<string, ExerciseDef<unknown>>()

  register<A>(def: ExerciseDef<A>): this {
    if (this.#defs.has(def.id)) throw new Error(`duplicate exercise id: ${def.id}`)
    this.#defs.set(def.id, def as unknown as ExerciseDef<unknown>)
    return this
  }

  get(id: string): ExerciseDef<unknown> | undefined {
    return this.#defs.get(id)
  }

  list(): ExerciseDef<unknown>[] {
    return [...this.#defs.values()]
  }

  forCard(card: Card, learner: Learner): ExerciseDef<unknown>[] {
    return this.list().filter((d) => d.supports(card, learner))
  }
}
