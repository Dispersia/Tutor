import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrate } from './migrate'
import * as schema from './schema'

export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  // The maintenance scripts open the same file while the server runs: wait for a
  // competing writer instead of failing the request with SQLITE_BUSY.
  sqlite.exec('PRAGMA busy_timeout = 5000')
  // WAL is durable across app crashes at NORMAL; FULL fsyncs every autocommit.
  sqlite.exec('PRAGMA synchronous = NORMAL')
  const applied = migrate(sqlite)
  const db = drizzle(sqlite, { schema })
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`)
  return { sqlite, db }
}

export type Db = ReturnType<typeof openDb>['db']
export type Sqlite = ReturnType<typeof openDb>['sqlite']
