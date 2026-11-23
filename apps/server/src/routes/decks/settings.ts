/**
 * A deck's own lifecycle and rules: rename, toggle its reading/variant settings,
 * or delete it with all its cards and history (docs/DESIGN.md §12.4, §13.7).
 */

import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deleteDeck, getDeck, updateDeckSettings } from '../../db/repo'
import { publicDeckSettings } from '../../deck/settings'
import { deckView } from './view'

interface PatchDeckBody {
  name?: string
  settings?: {
    showReadings?: boolean
    readingScript?: string
    variant?: 'traditional' | 'simplified'
    disabledExercises?: string[]
    pitchAccent?: boolean
  }
}

export function registerDeckSettings(app: App) {
  app.delete('/api/decks/:id', (c) => deleteDeckHandler(c))
  app.patch('/api/decks/:id', (c) => patchDeckHandler(c))
}

/** Delete a deck completely: cards, SRS state, history and deck chats. */
function deleteDeckHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = String(c.req.param('id'))
  if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
  deleteDeck(deps.db, deckId, user.id)
  return c.json({ ok: true, deckId })
}

/** Update a deck's own rules (ruby/reading override, variant, toggles). */
async function patchDeckHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = String(c.req.param('id'))
  if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as PatchDeckBody
  const settings = body.settings
    ? updateDeckSettings(deps.db, deckId, user.id, body.settings)
    : undefined
  return c.json({
    deck: deckView(getDeck(deps.db, deckId, user.id)!),
    settings: settings ? publicDeckSettings(settings) : undefined,
  })
}
