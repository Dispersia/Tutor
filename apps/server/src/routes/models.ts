import { OpenRouter, type ModelInfo } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { currentUser } from './auth'
import type { App } from '../context'

export function registerModels(app: App) {
  // Live OpenRouter catalogue for the per-role model picker (§10.1).
  //
  // The endpoint stays reachable signed-out, but when a session is present we
  // list models with that user's key (`/models/user`) so the picker only offers
  // what their key can actually call — provider preferences, privacy settings
  // and guardrails included. Anonymous callers get the server key or the public
  // catalogue.
  app.get('/api/models', async (c) => {
    const deps = c.get('deps')
    const q = c.req.query('q')?.toLowerCase().trim()
    const limit = Math.min(Number(c.req.query('limit') ?? 300) || 300, 1000)
    const user = currentUser(c)
    const key = user ? await resolveUserKey(deps, user.id) : deps.serverKey
    const or = key ? new OpenRouter(key, deps.or.baseUrl) : deps.or
    try {
      let models: ModelInfo[]
      try {
        models = await or.listModels({ user: Boolean(key) })
      } catch (err) {
        // A bad or scoped key can't read the user catalogue — fall back to the
        // public one so the picker still works (the key error surfaces on chat).
        if (!key) throw err
        models = await or.listModels()
      }
      models = models.filter((m) => m.outputModalities.includes('text'))
      if (q) {
        models = models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
        )
      }
      models.sort((a, b) => a.id.localeCompare(b.id))
      return c.json({ count: models.length, models: models.slice(0, limit) })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502)
    }
  })
}
