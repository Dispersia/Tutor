import type { App } from '../../context'
import { listDecks } from '../../db/repo'
import { deckView } from './view'

export function registerDeckList(app: App) {
  app.get('/api/decks', (c) => {
    const deps = c.get('deps')
    return c.json({ decks: listDecks(deps.db, c.get('user')!.id).map(deckView) })
  })
}
