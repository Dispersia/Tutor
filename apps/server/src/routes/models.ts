import type { Context } from 'hono'
import { OpenRouter, type ModelInfo } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { currentUser } from './auth'
import type { App, AppEnv } from '../context'
import { fail } from './errors'

/** How long a fetched catalogue is served before it is fetched again. */
const CATALOGUE_TTL_MS = 10 * 60_000
/** A bound on the cache: one entry per distinct key, and keys are few. */
const CATALOGUE_MAX_ENTRIES = 200

interface Catalogue {
  at: number
  models: Promise<ModelInfo[]>
}

/**
 * Catalogues by base URL + key. Module-level because a client is built per
 * request (it carries that member's key), so the client's own cache never
 * survived one: every open of the model picker re-downloaded the whole list.
 */
const catalogues = new Map<string, Catalogue>()

/** The key is hashed so the secret itself is never held as a map key. */
function catalogueKey(baseUrl: string, key: string | undefined): string {
  if (!key) return `${baseUrl}|public`
  return `${baseUrl}|${new Bun.CryptoHasher('sha256').update(key).digest('hex')}`
}

/** Test hook: forget every cached catalogue. */
export function clearModelCatalogues(): void {
  catalogues.clear()
}

/** The catalogue for this base URL + key, fetched at most once per TTL. */
function cachedModels(or: OpenRouter, key: string | undefined): Promise<ModelInfo[]> {
  const id = catalogueKey(or.baseUrl, key)
  const hit = catalogues.get(id)
  if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) return hit.models
  if (catalogues.size >= CATALOGUE_MAX_ENTRIES) catalogues.clear()
  const models = listFor(or, Boolean(key)).catch((err: unknown) => {
    // A failed fetch is not cached: the next request tries again.
    if (catalogues.get(id)?.models === models) catalogues.delete(id)
    throw err
  })
  catalogues.set(id, { at: Date.now(), models })
  return models
}

export function registerModels(app: App) {
  app.get('/api/models', (c) => modelsHandler(c))
}

/**
 * Live OpenRouter catalogue for the per-role model picker (§10.1).
 *
 * The endpoint stays reachable signed-out, but when a session is present we list
 * models with that user's key (`/models/user`) so the picker only offers what
 * their key can actually call — provider preferences, privacy settings and
 * guardrails included. Anonymous callers get the server key or the public
 * catalogue.
 */
async function modelsHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = currentUser(c)
  const key = user ? await resolveUserKey(deps, user.id) : deps.serverKey
  const or = key ? new OpenRouter(key, deps.or.baseUrl) : deps.or
  const limit = Math.min(Number(c.req.query('limit') ?? 300) || 300, 1000)
  const q = c.req.query('q')?.toLowerCase().trim()
  try {
    const models = await loadModels(or, key, q)
    return c.json({ count: models.length, models: models.slice(0, limit) })
  } catch (err) {
    return fail(c, 502, (err as Error).message)
  }
}

/** The catalogue, filtered to text output and the query, then sorted by id. */
async function loadModels(
  or: OpenRouter,
  key: string | undefined,
  q: string | undefined,
): Promise<ModelInfo[]> {
  // `filter` copies, so the cached array is never sorted or narrowed in place.
  let models = await cachedModels(or, key)
  models = models.filter((m) => m.outputModalities.includes('text'))
  if (q) {
    models = models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    )
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

async function listFor(or: OpenRouter, hasKey: boolean): Promise<ModelInfo[]> {
  try {
    return await or.listModels({ user: hasKey })
  } catch (err) {
    // A bad or scoped key can't read the user catalogue — fall back to the public
    // one so the picker still works (the key error surfaces on chat).
    if (!hasKey) throw err
    return or.listModels()
  }
}
