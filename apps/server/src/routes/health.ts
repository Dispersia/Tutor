import { getRoles } from '../db/repo'
import type { App } from '../context'

export function registerHealth(app: App) {
  app.get('/api/health', async (c) => {
    const deps = c.get('deps')
    const speech = await deps.supervisor.status()
    return c.json({
      ok: true,
      name: 'tutor',
      phase: 2,
      openrouter: deps.or.configured,
      roles: getRoles(deps.db, deps.defaults),
      speech,
    })
  })
}
