import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzip } from './zip'

/**
 * Reads an Anki `.apkg` into notes (docs/DESIGN.md §13.7). An `.apkg` is a zip
 * holding a SQLite collection; newer Anki zstd-compresses that file
 * (`collection.anki21b`), older ones store it raw (`collection.anki2`/`anki21`).
 *
 * Only the fields the deck builder needs are read: each note's fields (joined
 * with U+001F in Anki), its model's field names, and the deck order.
 */

export interface AnkiModel {
  name: string
  /** Field names, in order. */
  fields: string[]
}

export interface AnkiNote {
  /** One entry per field of the note's model, in field order. */
  fields: string[]
  tags: string[]
  /** Sort position: the note's earliest card due value (deck order). */
  order: number
}

export interface AnkiDeck {
  /** The deck's name, when it can be read. */
  name?: string
  /** Model id → its field names. */
  models: Record<string, AnkiModel>
  notes: AnkiNote[]
}

const COLLECTION_NAMES = ['collection.anki21b', 'collection.anki21', 'collection.anki2']

/** Picks and decodes the collection database out of the zip entries. */
function collectionBytes(entries: Map<string, Uint8Array>): Uint8Array | undefined {
  for (const name of COLLECTION_NAMES) {
    const bytes = entries.get(name)
    if (!bytes) continue
    // anki21b is zstd-compressed; the others are raw SQLite
    return name.endsWith('anki21b') ? Bun.zstdDecompressSync(bytes) : bytes
  }
  return undefined
}

function parseModels(json: string | null): Record<string, AnkiModel> {
  const out: Record<string, AnkiModel> = {}
  if (!json) return out
  try {
    const parsed = JSON.parse(json) as Record<
      string,
      { name?: string; flds?: { name?: string; ord?: number }[] }
    >
    for (const [mid, model] of Object.entries(parsed)) {
      const fields = (model.flds ?? [])
        .slice()
        .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))
        .map((f) => f.name ?? '')
      out[mid] = { name: model.name ?? 'Note', fields }
    }
  } catch {
    // ignore malformed models
  }
  return out
}

/** Reads an `.apkg` (or `.colpkg`) into a deck of notes. */
export async function readApkg(bytes: Uint8Array): Promise<AnkiDeck> {
  const entries = await unzip(bytes)
  const sqlite = collectionBytes(entries)
  if (!sqlite) throw new Error('no Anki collection found in the package')

  const dir = mkdtempSync(join(tmpdir(), 'tutor-anki-'))
  const path = join(dir, 'collection.anki2')
  try {
    writeFileSync(path, sqlite)
    const db = new Database(path, { readonly: true })
    try {
      const col = db.query('SELECT models, decks FROM col LIMIT 1').get() as
        | { models: string | null; decks: string | null }
        | undefined
      const models = parseModels(col?.models ?? null)

      // order notes by their earliest card's due value (Anki's new-card order)
      const orderRows = db.query('SELECT nid, MIN(due) AS due FROM cards GROUP BY nid').all() as {
        nid: number
        due: number
      }[]
      const order = new Map(orderRows.map((r) => [r.nid, r.due]))

      const rows = db
        .query('SELECT id, mid, flds, tags FROM notes')
        .all() as { id: number; mid: number; flds: string; tags: string }[]

      const notes: AnkiNote[] = rows
        .map((r) => ({
          fields: r.flds.split('\u001f'),
          tags: r.tags.trim().split(/\s+/).filter(Boolean),
          order: order.get(r.id) ?? r.id,
        }))
        .sort((a, b) => a.order - b.order)

      return { name: deckName(db, col?.decks ?? null), models, notes }
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The deck that holds most of the cards, by name. */
function deckName(db: Database, decksJson: string | null): string | undefined {
  if (!decksJson) return undefined
  try {
    const decks = JSON.parse(decksJson) as Record<string, { name?: string }>
    const top = db
      .query('SELECT did, COUNT(*) AS n FROM cards GROUP BY did ORDER BY n DESC LIMIT 1')
      .get() as { did: number } | undefined
    if (top && decks[String(top.did)]?.name) return decks[String(top.did)]!.name
    const first = Object.values(decks).find((d) => d.name && d.name !== 'Default')
    return first?.name
  } catch {
    return undefined
  }
}
