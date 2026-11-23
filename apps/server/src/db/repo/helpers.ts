import type { Db } from '../client'
import { deferEvents } from '../../events'

export const now = (): number => Date.now()
export const id = (): string => crypto.randomUUID()
export const newId = <T extends string>(): T => id() as T

export function inTransaction<T>(db: Db, fn: (tx: Db) => T): T {
  return deferEvents(() => db.transaction((tx) => fn(tx as unknown as Db)))
}

export function atomic<A extends unknown[], R>(
  fn: (db: Db, ...args: A) => R,
): (db: Db, ...args: A) => R {
  return (db, ...args) => inTransaction(db, (tx) => fn(tx, ...args))
}
