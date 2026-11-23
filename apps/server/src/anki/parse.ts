import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzip } from './zip'

export interface AnkiModel {
  name: string
  fields: string[]
}

export interface AnkiNote {
  mid: number
  fields: string[]
  tags: string[]
  order: number
}

export interface AnkiDeck {
  name?: string
  models: Record<string, AnkiModel>
  notes: AnkiNote[]
}

const COLLECTION_NAMES = ['collection.anki21b', 'collection.anki21', 'collection.anki2']

function collectionBytes(entries: Map<string, Uint8Array>): Uint8Array | undefined {
  for (const name of COLLECTION_NAMES) {
    const bytes = entries.get(name)
    if (!bytes) continue
    return name.endsWith('anki21b') ? inflateCollection(bytes) : bytes
  }
  return undefined
}

const MAX_COLLECTION_BYTES = 512 * 1024 * 1024

function inflateCollection(bytes: Uint8Array): Uint8Array {
  const declared = zstdContentSize(bytes)
  if (declared !== undefined && declared > MAX_COLLECTION_BYTES) {
    throw new Error('the Anki collection is too large to import')
  }
  return Bun.zstdDecompressSync(bytes)
}

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
  } catch {}
  return out
}

function readModels(db: Database): Record<string, AnkiModel> {
  const legacy = legacyModels(db)
  return Object.keys(legacy).length ? legacy : tableModels(db)
}

function legacyModels(db: Database): Record<string, AnkiModel> {
  try {
    const row = db.query('SELECT models FROM col LIMIT 1').get() as { models?: string } | undefined
    return parseModels(row?.models ?? null)
  } catch {
    return {}
  }
}

function tableModels(db: Database): Record<string, AnkiModel> {
  const out: Record<string, AnkiModel> = {}
  try {
    for (const nt of notetypesOf(db)) out[String(nt.id)] = { name: nt.name, fields: [] }
    attachFields(out, fieldsOf(db))
  } catch {}
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

function prettyDeckName(name: string | undefined): string | undefined {
  if (!name) return name
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/\u001f/g, ' / ').trim()
  return cleaned || undefined
}

function readDeckName(db: Database): string | undefined {
  return legacyDeckName(db) ?? tableDeckName(db)
}

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

function topDeckId(db: Database): number | undefined {
  const top = db
    .query('SELECT did, COUNT(*) AS n FROM cards GROUP BY did ORDER BY n DESC LIMIT 1')
    .get() as { did: number } | undefined
  return top?.did
}

export async function readApkg(bytes: Uint8Array): Promise<AnkiDeck> {
  const entries = await unzip(bytes, { filter: (name) => COLLECTION_NAMES.includes(name) })
  const collection = collectionBytes(entries)
  if (!collection) throw new Error('no Anki collection found in the package')
  const dir = mkdtempSync(join(tmpdir(), 'tutor-anki-'))
  const path = join(dir, 'collection.anki2')
  try {
    writeFileSync(path, relaxCollations(collection))
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

function noteOrder(db: Database): Map<number, number> {
  const rows = db.query('SELECT nid, MIN(due) AS due FROM cards GROUP BY nid').all() as {
    nid: number
    due: number
  }[]
  return new Map(rows.map((r) => [r.nid, r.due]))
}
