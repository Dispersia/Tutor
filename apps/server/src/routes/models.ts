import type { Context } from 'hono'
import { OpenRouter, type ModelInfo } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { currentUser } from './auth'
import type { App, AppEnv } from '../context'
import { fail } from './errors'

const CATALOGUE_TTL_MS = 10 * 60_000
const CATALOGUE_MAX_ENTRIES = 200

interface Catalogue {
  at: number
  models: Promise<ModelInfo[]>
}

const catalogues = new Map<string, Catalogue>()

function catalogueKey(baseUrl: string, key: string | undefined): string {
  if (!key) return `${baseUrl}|public`
  return `${baseUrl}|${new Bun.CryptoHasher('sha256').update(key).digest('hex')}`
}

export function clearModelCatalogues(): void {
  catalogues.clear()
}

function cachedModels(or: OpenRouter, key: string | undefined): Promise<ModelInfo[]> {
  const id = catalogueKey(or.baseUrl, key)
  const hit = catalogues.get(id)
  if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) return hit.models
  if (catalogues.size >= CATALOGUE_MAX_ENTRIES) catalogues.clear()
  const models = listFor(or, Boolean(key)).catch((err: unknown) => {
    if (catalogues.get(id)?.models === models) catalogues.delete(id)
    throw err
  })
  catalogues.set(id, { at: Date.now(), models })
  return models
}

export function registerModels(app: App) {
  app.get('/api/models', (c) => modelsHandler(c))
}

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

async function loadModels(
  or: OpenRouter,
  key: string | undefined,
  q: string | undefined,
): Promise<ModelInfo[]> {
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
    if (!hasKey) throw err
    return or.listModels()
  }
}
