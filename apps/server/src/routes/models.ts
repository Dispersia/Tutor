import type { App } from '../context'

export function registerModels(app: App) {
  // Live OpenRouter catalogue for the per-role model picker (§10.1).
  app.get('/api/models', async (c) => {
    const deps = c.get('deps')
    const q = c.req.query('q')?.toLowerCase().trim()
    const limit = Math.min(Number(c.req.query('limit') ?? 300) || 300, 1000)
    try {
      let models = await deps.or.listModels()
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
