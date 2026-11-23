const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50

export const MAX_ENTRY_BYTES = 512 * 1024 * 1024

export interface UnzipOptions {
  filter?: (name: string) => boolean
  maxEntryBytes?: number
}

const tooLarge = (name: string, max: number) =>
  new Error(`zip entry "${name}" is larger than the ${max}-byte limit`)

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

function findEocd(view: DataView): number {
  for (let i = view.byteLength - 22; i >= 0 && i >= view.byteLength - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  throw new Error('not a zip file (no end-of-central-directory)')
}

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
  data: Uint8Array | undefined
  next: number
}

async function readEntry(ptr: number, ctx: EntryCtx): Promise<ZipEntry> {
  const { view, decoder, bytes } = ctx
  const compSize = view.getUint32(ptr + 20, true)
  const nameLen = view.getUint16(ptr + 28, true)
  const extraLen = view.getUint16(ptr + 30, true)
  const commentLen = view.getUint16(ptr + 32, true)
  const localOffset = view.getUint32(ptr + 42, true)
  const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
  const next = ptr + 46 + nameLen + extraLen + commentLen
  if (name.endsWith('/') || (ctx.filter && !ctx.filter(name))) {
    return { name, data: undefined, next }
  }
  const start =
    localOffset +
    30 +
    view.getUint16(localOffset + 26, true) +
    view.getUint16(localOffset + 28, true)
  const raw = bytes.subarray(start, start + compSize)
  return { name, data: await entryData(ptr, name, raw, ctx), next }
}

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
