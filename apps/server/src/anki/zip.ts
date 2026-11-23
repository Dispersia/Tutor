/**
 * Minimal ZIP reader (docs/DESIGN.md §13.7). Anki packages are zips, so the
 * importer only needs to read entries — no dependency, no extraction to disk.
 * Supports the two methods Anki uses: stored (0) and deflate (8).
 */

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50

/** The largest entry the reader will inflate: far above any real collection. */
export const MAX_ENTRY_BYTES = 512 * 1024 * 1024

export interface UnzipOptions {
  /** Only entries whose name passes are read; the rest are skipped unopened. */
  filter?: (name: string) => boolean
  /** Inflated-size cap per entry (default {@link MAX_ENTRY_BYTES}). */
  maxEntryBytes?: number
}

const tooLarge = (name: string, max: number) =>
  new Error(`zip entry "${name}" is larger than the ${max}-byte limit`)

/**
 * Inflates one entry, stopping as soon as it grows past `max` — the declared
 * size in the header is not trusted, so a zip bomb cannot exhaust memory.
 */
async function inflateRaw(data: Uint8Array, name: string, max: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw tooLarge(name, max)
    }
    chunks.push(value)
  }
  return joinChunks(chunks, size)
}

function joinChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** Finds the End Of Central Directory record, scanning back from the end. */
function findEocd(view: DataView): number {
  for (let i = view.byteLength - 22; i >= 0 && i >= view.byteLength - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  throw new Error('not a zip file (no end-of-central-directory)')
}

/**
 * Reads a zip archive's entries into a name → bytes map. With `opts.filter`
 * only the matching entries are inflated — an Anki package is mostly media, and
 * the importer needs one file out of it.
 */
export async function unzip(
  bytes: Uint8Array,
  opts: UnzipOptions = {},
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  const count = view.getUint16(eocd + 10, true)
  let ptr = view.getUint32(eocd + 16, true)

  const max = opts.maxEntryBytes ?? MAX_ENTRY_BYTES
  const ctx: EntryCtx = { view, decoder: new TextDecoder(), bytes, filter: opts.filter, max }
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== CEN_SIG) break
    const entry = await readEntry(ptr, ctx)
    if (entry.data) out.set(entry.name, entry.data)
    ptr = entry.next
  }
  return out
}

interface EntryCtx {
  view: DataView
  decoder: TextDecoder
  bytes: Uint8Array
  filter?: (name: string) => boolean
  max: number
}

interface ZipEntry {
  name: string
  /** undefined for a directory entry or one the filter skipped (nothing read) */
  data: Uint8Array | undefined
  next: number
}

/** One central-directory entry: its name, data and the next entry's offset. */
async function readEntry(ptr: number, ctx: EntryCtx): Promise<ZipEntry> {
  const { view, decoder, bytes } = ctx
  const compSize = view.getUint32(ptr + 20, true)
  const nameLen = view.getUint16(ptr + 28, true)
  const extraLen = view.getUint16(ptr + 30, true)
  const commentLen = view.getUint16(ptr + 32, true)
  const localOffset = view.getUint32(ptr + 42, true)
  const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
  const next = ptr + 46 + nameLen + extraLen + commentLen
  // a directory, or an entry the caller did not ask for: never opened
  if (name.endsWith('/') || (ctx.filter && !ctx.filter(name))) {
    return { name, data: undefined, next }
  }
  // the local header repeats the name/extra lengths and may differ from the
  // central directory's, so the data offset must be read from it
  const start =
    localOffset +
    30 +
    view.getUint16(localOffset + 26, true) +
    view.getUint16(localOffset + 28, true)
  const raw = bytes.subarray(start, start + compSize)
  return { name, data: await entryData(ptr, name, raw, ctx), next }
}

/** The entry's bytes: copied when stored (method 0), inflated when deflated. */
async function entryData(
  ptr: number,
  name: string,
  raw: Uint8Array,
  ctx: EntryCtx,
): Promise<Uint8Array> {
  const method = ctx.view.getUint16(ptr + 10, true)
  const declared = ctx.view.getUint32(ptr + 24, true)
  if (declared > ctx.max || (method === 0 && raw.length > ctx.max)) throw tooLarge(name, ctx.max)
  return method === 0 ? raw.slice() : inflateRaw(raw, name, ctx.max)
}
