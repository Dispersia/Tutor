import { rebuildStats, summary } from '../game/service'
import type { App } from '../context'

export function registerStats(app: App) {
  app.get('/api/stats', (c) => c.json(summary(c.get('deps').db, c.get('user')!.id)))

  // Proof that all cached stats are derivable from the append-only XP ledger.
  app.post('/api/stats/rebuild', (c) => c.json(rebuildStats(c.get('deps').db, c.get('user')!.id)))
}
