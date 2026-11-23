/** `GET /api/decks` — the member's decks (docs/DESIGN.md §12.4). */

import type { App } from '../../context'
import { listDecks } from '../../db/repo'
import { deckView } from './view'

export function registerDeckList(app: App) {
  app.get('/api/decks', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    return c.json({ decks: listDecks(deps.db, user.id).map(deckView) })
  })
}
