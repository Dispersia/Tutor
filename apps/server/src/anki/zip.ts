/**
 * Minimal ZIP reader (docs/DESIGN.md §13.7). Anki packages are zips, so the
 * importer only needs to read entries — no dependency, no extraction to disk.
 * Supports the two methods Anki uses: stored (0) and deflate (8).
 */

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** Finds the End Of Central Directory record, scanning back from the end. */
function findEocd(view: DataView): number {
  for (let i = view.byteLength - 22; i >= 0 && i >= view.byteLength - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  throw new Error('not a zip file (no end-of-central-directory)')
}

/** Reads every entry of a zip archive into a name → bytes map. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  const count = view.getUint16(eocd + 10, true)
  let ptr = view.getUint32(eocd + 16, true)

  const decoder = new TextDecoder()
  const out = new Map<string, Uint8Array>()

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== CEN_SIG) break
    const method = view.getUint16(ptr + 10, true)
    const compSize = view.getUint32(ptr + 20, true)
    const nameLen = view.getUint16(ptr + 28, true)
    const extraLen = view.getUint16(ptr + 30, true)
    const commentLen = view.getUint16(ptr + 32, true)
    const localOffset = view.getUint32(ptr + 42, true)
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))

    // the local header repeats the name/extra lengths and may differ from the
    // central directory's, so the data offset must be read from it
    const lNameLen = view.getUint16(localOffset + 26, true)
    const lExtraLen = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(start, start + compSize)

    if (!name.endsWith('/')) {
      out.set(name, method === 0 ? raw.slice() : await inflateRaw(raw))
    }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return out
}
