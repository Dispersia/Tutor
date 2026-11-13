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
  const applied = migrate(sqlite)
  const db = drizzle(sqlite, { schema })
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`)
  return { sqlite, db }
}

export type Db = ReturnType<typeof openDb>['db']
export type Sqlite = ReturnType<typeof openDb>['sqlite']
