import { activitySeries, rebuildStats, summary } from '../services'
import { quietState } from '../services/quiet'
import type { App } from '../context'

export function registerStats(app: App) {
  app.get('/api/stats', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    // `activity` feeds the home activity map; `quietUntil` lets the client render
    // the "can't speak or listen" window.
    return c.json({
      ...summary(deps.db, user.id),
      activity: activitySeries(deps.db, user.id),
      quietUntil: quietState(deps.db, user.id).until,
    })
  })

  // Proof that all cached stats are derivable from the append-only XP ledger.
  app.post('/api/stats/rebuild', (c) => c.json(rebuildStats(c.get('deps').db, c.get('user')!.id)))
}
