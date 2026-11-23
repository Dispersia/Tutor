import { curriculumView, srsStats } from '../services'
import type { App } from '../context'

export function registerCurriculum(app: App) {
  app.get('/api/curriculum', (c) =>
    c.json({ decks: curriculumView(c.get('deps').db, c.get('user')!.id) }),
  )

  app.get('/api/srs/stats', (c) => c.json(srsStats(c.get('deps').db, c.get('user')!.id)))
}
