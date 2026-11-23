/** Repo internals shared by every query module: the clock, ids and transactions. */

import type { Db } from '../client'

export const now = (): number => Date.now()
export const id = (): string => crypto.randomUUID()

/**
 * Runs `fn` in one SQLite transaction. The callback receives the transaction as
 * a `Db`, so ordinary repo helpers can be used inside it: a multi-write use case
 * (a rig settle, a combat exchange) then commits all-or-nothing instead of
 * leaving a half-written state if one statement fails.
 */
export function inTransaction<T>(db: Db, fn: (tx: Db) => T): T {
  return db.transaction((tx) => fn(tx as unknown as Db))
}

/**
 * Makes a synchronous use case all-or-nothing: `atomic(fn)` has `fn`'s
 * signature and runs it inside one transaction (a savepoint when it is called
 * from another atomic use case), so a throw part-way leaves nothing half-written.
 */
export function atomic<A extends unknown[], R>(
  fn: (db: Db, ...args: A) => R,
): (db: Db, ...args: A) => R {
  return (db, ...args) => inTransaction(db, (tx) => fn(tx, ...args))
}
