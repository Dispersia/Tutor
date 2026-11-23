import { expect, test } from 'bun:test'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { openDb } from './client'
import * as schema from './schema'

const tables = (Object.values(schema) as unknown[]).filter(
  (t): t is SQLiteTable => typeof t === 'object' && t !== null && Symbol.for('drizzle:Name') in t,
)

const RETIRED: Record<string, string[]> = { srs: ['ease'] }

function database() {
  const { sqlite } = openDb(':memory:')
  const columns = (table: string) =>
    sqlite.query(`pragma table_info(${table})`).all() as { name: string; pk: number }[]
  const indexes = (table: string) =>
    (sqlite.query(`pragma index_list(${table})`).all() as { name: string }[]).map((i) => i.name)
  return { sqlite, columns, indexes }
}

test('every schema table, column, primary key and index exists in the migrated database', () => {
  const { sqlite, columns, indexes } = database()
  expect(tables.length).toBeGreaterThan(20)
  for (const table of tables) {
    const cfg = getTableConfig(table)
    const actual = columns(cfg.name)
    expect({ table: cfg.name, exists: actual.length > 0 }).toEqual({
      table: cfg.name,
      exists: true,
    })
    const names = actual.map((c) => c.name)
    for (const col of cfg.columns) {
      expect({ table: cfg.name, column: col.name, found: names.includes(col.name) }).toEqual({
        table: cfg.name,
        column: col.name,
        found: true,
      })
    }
    const declaredPk = [
      ...cfg.columns.filter((c) => c.primary).map((c) => c.name),
      ...cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)),
    ].sort()
    const actualPk = actual
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort()
    expect({ table: cfg.name, pk: declaredPk }).toEqual({ table: cfg.name, pk: actualPk })
    for (const idx of cfg.indexes) {
      const name = idx.config.name
      expect({ table: cfg.name, index: name, found: indexes(cfg.name).includes(name) }).toEqual({
        table: cfg.name,
        index: name,
        found: true,
      })
    }
  }
  sqlite.close()
})

test('the database has no column the schema does not know about', () => {
  const { sqlite, columns } = database()
  for (const table of tables) {
    const cfg = getTableConfig(table)
    const known = new Set([...cfg.columns.map((c) => c.name), ...(RETIRED[cfg.name] ?? [])])
    const extra = columns(cfg.name)
      .map((c) => c.name)
      .filter((name) => !known.has(name))
    expect({ table: cfg.name, extra }).toEqual({ table: cfg.name, extra: [] })
  }
  sqlite.close()
})
