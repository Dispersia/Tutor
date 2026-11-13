import type { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIGRATIONS } from './migrations.gen'

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations')

/** Reads migrations from disk (dev), falling back to the embedded copy (binary). */
function load(): { name: string; sql: string }[] {
  try {
    if (existsSync(MIGRATIONS_DIR)) {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
      if (files.length) {
        return files.map((name) => ({
          name,
          sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
        }))
      }
    }
  } catch {
    // fall through to embedded
  }
  return MIGRATIONS
}

/** Applies any unapplied migrations, in filename order. */
export function migrate(sqlite: Database): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const applied = new Set(
    (sqlite.query('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  )

  const ran: string[] = []
  for (const { name, sql } of load()) {
    if (applied.has(name)) continue
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql)
      sqlite.query('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now())
    })
    tx()
    ran.push(name)
  }
  return ran
}
