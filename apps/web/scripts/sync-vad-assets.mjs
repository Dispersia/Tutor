#!/usr/bin/env bun
/**
 * Copies the Silero VAD weights and the onnxruntime-web wasm runtime out of
 * node_modules into `apps/web/static/vad`, content-hashed, plus a manifest the
 * app reads at runtime (see src/lib/vad.ts).
 *
 * Why not import them? The wasm runtime is ~15 MB and only matters when someone
 * records, so it is fetched lazily by the browser instead of being bundled. The
 * hashes let the server cache them as immutable: a new dependency version is a
 * new URL, so no stale cache and no prod re-download of them every hour.
 *
 * Run from `apps/web` (the `build` and `dev` scripts do it for you).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const web = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(web, 'static', 'vad')

/** node_modules/<name>, without depending on the package's `exports` map. */
function packageDir(name, from = []) {
  try {
    return dirname(require.resolve(`${name}/package.json`, { paths: from }))
  } catch {
    // fall back to walking up from here (bun hoists to the workspace root)
    let dir = web
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'node_modules', name)
      if (existsSync(candidate)) return candidate
      dir = dirname(dir)
    }
    throw new Error(`cannot find ${name}; run \`bun install\` first`)
  }
}

const vadDir = packageDir('@ricky0123/vad-web')
// bun keeps transitive deps in its store, so resolve through vad-web's real path.
const ortDir = packageDir('onnxruntime-web', [realpathSync(vadDir)])

const sources = {
  // Silero v4 (the model NonRealTimeVAD drives): 512-sample hop, tiny and fast.
  model: join(vadDir, 'dist', 'silero_vad_legacy.onnx'),
  // The wasm-only runtime the vad build imports (`onnxruntime-web/wasm`).
  wasm: join(ortDir, 'dist', 'ort-wasm-simd-threaded.wasm'),
  mjs: join(ortDir, 'dist', 'ort-wasm-simd-threaded.mjs'),
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const manifest = {}
for (const [key, src] of Object.entries(sources)) {
  if (!existsSync(src)) throw new Error(`missing ${key} asset: ${src}`)
  const bytes = readFileSync(src)
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
  const ext = src.slice(src.lastIndexOf('.'))
  const name = `${key}-${hash}${ext}`
  writeFileSync(join(outDir, name), bytes)
  manifest[key] = name
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const kb = Object.values(sources).reduce((n, p) => n + readFileSync(p).byteLength, 0) / 1024
console.log(`vad: ${Object.values(manifest).join(', ')} (${Math.round(kb)} KB)`)
