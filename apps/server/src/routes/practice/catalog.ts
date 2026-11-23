/** The practice catalog and session toggles (docs/DESIGN.md §11.2, §9.4). */

import { CARD_TEMPLATES } from '@tutor/core'
import type { App } from '../../context'
import { exerciseCatalog } from '../../exercises'
import { setQuiet } from '../../game/quiet'

/** `/api/exercises`, `/api/templates` and the quiet-mode toggle. */
export function registerCatalog(app: App) {
  app.get('/api/exercises', (c) => c.json({ exercises: exerciseCatalog() }))

  // The reusable card templates (vocab, spoken, listening, sentence, grammar):
  // each names the content it needs and the exercises that realise it.
  app.get('/api/templates', (c) => c.json({ templates: CARD_TEMPLATES }))

  // "I can't speak or listen right now": hide listen/speak cards for 15 minutes.
  // It is a time-boxed window that lifts on its own; XP is unaffected.
  app.post('/api/practice/quiet', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean }
    const state = setQuiet(deps.db, user.id, Boolean(body.enabled))
    return c.json({ quietUntil: state.until })
  })
}
