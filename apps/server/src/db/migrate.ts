import type { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations')

/** Applies any unapplied .sql files in apps/server/migrations, in filename order. */
export function migrate(sqlite: Database): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const applied = new Set(
    (sqlite.query('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  )
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql)
      sqlite.query('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now())
    })
    tx()
    ran.push(file)
  }
  return ran
}
