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
