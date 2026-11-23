import type { App } from '../../context'
import { bumpDailyExtra, readStudyPrefs } from '../../services/study'
import { studyBudget } from '../../services'

export function registerStudyMore(app: App) {
  app.post('/api/study/more', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const prefs = readStudyPrefs(deps.db, user.id)
    bumpDailyExtra(deps.db, user.id, {
      newExtra: prefs.newPerDay > 0 ? prefs.newPerDay : 0,
      reviewsExtra: prefs.maxReviewsPerDay > 0 ? prefs.maxReviewsPerDay : 0,
    })
    return c.json({ ok: true, budget: studyBudget(deps.db, user.id) })
  })
}
