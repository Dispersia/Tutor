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
 * Two things about modern packages need handling:
 *
 * - the collection is a **WAL** database, so it cannot be opened read-only;
 * - Anki declares a custom `unicase` collation on the `fields`/`templates`
 *   tables, which bun:sqlite cannot register, so we rewrite that collation to
 *   the built-in `BINARY` in the schema text (same byte length) before opening.
 *
 * Modern packages also drop the JSON blobs in `col` (models/decks) in favour of
 * `notetypes` + `fields` + `decks` tables, so the model is read from either.
 */

export interface AnkiModel {
  name: string
  /** Field names, in order. */
  fields: string[]
}

export interface AnkiNote {
  /** The note type (model) id. */
  mid: number
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
    return name.endsWith('anki21b') ? inflateCollection(bytes) : bytes
  }
  return undefined
}

/** The largest collection database an import will decompress. */
const MAX_COLLECTION_BYTES = 512 * 1024 * 1024

/**
 * Decompresses the collection, refusing a frame that declares more than the cap.
 * The zip layer caps what it inflates, but this inner zstd frame is a second
 * chance to expand a small upload into gigabytes.
 */
function inflateCollection(bytes: Uint8Array): Uint8Array {
  const declared = zstdContentSize(bytes)
  if (declared !== undefined && declared > MAX_COLLECTION_BYTES) {
    throw new Error('the Anki collection is too large to import')
  }
  return Bun.zstdDecompressSync(bytes)
}

/**
 * The decompressed size a zstd frame declares in its header (RFC 8878 §3.1.1),
 * or undefined when the frame does not say or the bytes are not a zstd frame.
 */
export function zstdContentSize(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 6 || view.getUint32(0, true) !== 0xfd2fb528) return undefined
  const descriptor = bytes[4]!
  const single = (descriptor & 0x20) !== 0
  const sizeFlag = descriptor >> 6
  const dictBytes = [0, 1, 2, 4][descriptor & 0x03]!
  const at = 5 + (single ? 0 : 1) + dictBytes
  const width = sizeFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][sizeFlag]!
  if (width === 0 || at + width > bytes.length) return undefined
  if (width === 1) return view.getUint8(at)
  if (width === 2) return view.getUint16(at, true) + 256
  if (width === 4) return view.getUint32(at, true)
  return Number(view.getBigUint64(at, true))
}

/**
 * Anki's custom `unicase` collation is unknown to bun:sqlite, which then refuses
 * to prepare any statement against the tables that declare it. Rewriting the
 * schema text to the built-in `BINARY` (the replacement is the same byte length)
 * makes those tables readable without touching any data.
 */
function relaxCollations(bytes: Uint8Array): Uint8Array {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!buf.includes('COLLATE unicase')) return bytes
  return new Uint8Array(
    Buffer.from(buf.toString('latin1').replaceAll('COLLATE unicase', 'COLLATE BINARY '), 'latin1'),
  )
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

/** Reads the note-type field names from the legacy `col` blob or the v18 tables. */
function readModels(db: Database): Record<string, AnkiModel> {
  const legacy = legacyModels(db)
  return Object.keys(legacy).length ? legacy : tableModels(db)
}

/** Legacy containers: a JSON blob in the `col` table. */
function legacyModels(db: Database): Record<string, AnkiModel> {
  try {
    const row = db.query('SELECT models FROM col LIMIT 1').get() as { models?: string } | undefined
    return parseModels(row?.models ?? null)
  } catch {
    return {}
  }
}

/** Modern containers: the notetypes + fields tables. */
function tableModels(db: Database): Record<string, AnkiModel> {
  const out: Record<string, AnkiModel> = {}
  try {
    for (const nt of notetypesOf(db)) out[String(nt.id)] = { name: nt.name, fields: [] }
    attachFields(out, fieldsOf(db))
  } catch {
    // fall through with whatever we have
  }
  return out
}

function notetypesOf(db: Database) {
  return db.query('SELECT id, name FROM notetypes').all() as { id: number; name: string }[]
}

function fieldsOf(db: Database) {
  return db.query('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord').all() as {
    ntid: number
    ord: number
    name: string
  }[]
}

function attachFields(
  out: Record<string, AnkiModel>,
  fields: { ntid: number; ord: number; name: string }[],
): void {
  for (const f of fields) {
    const model = out[String(f.ntid)]
    if (model) model.fields[f.ord] = f.name
  }
}

/** Anki joins parent/child deck names with U+001F; make that readable. */
function prettyDeckName(name: string | undefined): string | undefined {
  if (!name) return name
  // \u001f is Anki's field separator — a control char by design.
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/\u001f/g, ' / ').trim()
  return cleaned || undefined
}

/** The deck that holds most of the cards, by name. */
function readDeckName(db: Database): string | undefined {
  return legacyDeckName(db) ?? tableDeckName(db)
}

/** Legacy containers: the deck list is a JSON blob in `col`. */
function legacyDeckName(db: Database): string | undefined {
  try {
    const decksJson = (
      db.query('SELECT decks FROM col LIMIT 1').get() as { decks?: string } | undefined
    )?.decks
    if (!decksJson) return undefined
    const decks = JSON.parse(decksJson) as Record<string, { name?: string }>
    const top = topDeckId(db)
    if (top && decks[String(top)]?.name) return decks[String(top)]!.name
    const first = Object.values(decks).find((d) => d.name && d.name !== 'Default')
    return first?.name
  } catch {
    return undefined
  }
}

/** Modern containers: a `decks` table keyed by the busiest card's deck id. */
function tableDeckName(db: Database): string | undefined {
  try {
    const top = topDeckId(db)
    if (top) {
      const deck = db.query('SELECT name FROM decks WHERE id = ?').get(top) as
        { name?: string } | undefined
      if (deck?.name && deck.name !== 'Default') return deck.name
    }
    const first = db
      .query("SELECT name FROM decks WHERE name <> 'Default' ORDER BY id LIMIT 1")
      .get() as { name?: string } | undefined
    return first?.name
  } catch {
    return undefined
  }
}

/** The deck id holding the most cards (Anki's main deck). */
function topDeckId(db: Database): number | undefined {
  const top = db
    .query('SELECT did, COUNT(*) AS n FROM cards GROUP BY did ORDER BY n DESC LIMIT 1')
    .get() as { did: number } | undefined
  return top?.did
}

/** Reads an `.apkg` (or `.colpkg`) into a deck of notes. */
export async function readApkg(bytes: Uint8Array): Promise<AnkiDeck> {
  // Only the collection is inflated: the media (most of a package) is never read.
  const entries = await unzip(bytes, { filter: (name) => COLLECTION_NAMES.includes(name) })
  const collection = collectionBytes(entries)
  if (!collection) throw new Error('no Anki collection found in the package')
  const dir = mkdtempSync(join(tmpdir(), 'tutor-anki-'))
  const path = join(dir, 'collection.anki2')
  try {
    writeFileSync(path, relaxCollations(collection))
    // read-write: the collection is a WAL database, which cannot open read-only
    return readCollection(new Database(path))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readCollection(db: Database): AnkiDeck {
  try {
    return { name: prettyDeckName(readDeckName(db)), models: readModels(db), notes: readNotes(db) }
  } finally {
    db.close()
  }
}

interface NoteRow {
  id: number
  mid: number
  flds: string
  tags: string
}

function readNotes(db: Database): AnkiNote[] {
  const order = noteOrder(db)
  const rows = db.query('SELECT id, mid, flds, tags FROM notes').all() as NoteRow[]
  return rows
    .map((r) => ({
      mid: r.mid,
      fields: r.flds.split('\u001f'),
      tags: r.tags.trim().split(/\s+/).filter(Boolean),
      order: order.get(r.id) ?? r.id,
    }))
    .sort((a, b) => a.order - b.order)
}

/** Notes by their earliest card's due value (Anki's new-card order). */
function noteOrder(db: Database): Map<number, number> {
  const rows = db.query('SELECT nid, MIN(due) AS due FROM cards GROUP BY nid').all() as {
    nid: number
    due: number
  }[]
  return new Map(rows.map((r) => [r.nid, r.due]))
}
