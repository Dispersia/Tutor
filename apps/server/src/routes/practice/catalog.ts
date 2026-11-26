import type { App } from '../../context'
import { exerciseCatalog } from '../../exercises'
import { setQuiet } from '../../services/quiet'
import { bool, jsonBody } from '../body'

export function registerCatalog(app: App) {
  app.get('/api/exercises', (c) => c.json({ exercises: exerciseCatalog() }))

  app.post('/api/practice/quiet', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = await jsonBody(c)
    const state = setQuiet(deps.db, user.id, bool(body, 'enabled') === true)
    return c.json({ quietUntil: state.until })
  })
}
