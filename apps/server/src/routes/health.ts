import { countUsers } from '../db/repo'
import type { App } from '../context'

export function registerHealth(app: App) {
  app.get('/api/health', async (c) => {
    const deps = c.get('deps')
    const speech = await deps.supervisor.status()
    return c.json({
      ok: true,
      name: 'tutor',
      phase: 3,
      openrouter: Boolean(deps.serverKey),
      registrationOpen: deps.allowRegistration || countUsers(deps.db) === 0,
      speech,
    })
  })
}
