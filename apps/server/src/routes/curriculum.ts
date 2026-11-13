import { curriculumView, srsStats } from '../game/service'
import type { App } from '../context'

export function registerCurriculum(app: App) {
  // The guided path: decks split into themed lessons with completion + due counts.
  app.get('/api/curriculum', (c) =>
    c.json({ decks: curriculumView(c.get('deps').db, c.get('user')!.id) }),
  )

  // Spaced-repetition totals for the HUD.
  app.get('/api/srs/stats', (c) => c.json(srsStats(c.get('deps').db, c.get('user')!.id)))
}
