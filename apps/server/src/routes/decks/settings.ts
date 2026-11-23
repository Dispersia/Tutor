/**
 * A deck's own lifecycle and rules: rename, toggle its reading/variant settings,
 * or delete it with all its cards and history (docs/DESIGN.md §12.4, §13.7).
 */

import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deleteDeck, getDeck, updateDeckSettings } from '../../db/repo'
import { publicDeckSettings, type DeckSettings } from '../../deck/settings'
import { bool, jsonBody, obj, oneOf, str, strArray } from '../body'
import { deckView } from './view'

const VARIANTS = ['traditional', 'simplified'] as const

/** The settings a PATCH carries, keeping only the keys actually sent. */
function readSettings(body: Record<string, unknown>): Partial<DeckSettings> {
  const settings = obj(body, 'settings')
  if (!settings) return {}
  const patch: Partial<DeckSettings> = {}
  const showReadings = bool(settings, 'showReadings')
  if (showReadings !== undefined) patch.showReadings = showReadings
  const readingScript = str(settings, 'readingScript')
  if (readingScript !== undefined) patch.readingScript = readingScript
  const variant = oneOf(settings, 'variant', VARIANTS)
  if (variant !== undefined) patch.variant = variant
  const disabled = strArray(settings, 'disabledExercises')
  if (disabled !== undefined) patch.disabledExercises = disabled
  const pitchAccent = bool(settings, 'pitchAccent')
  if (pitchAccent !== undefined) patch.pitchAccent = pitchAccent
  return patch
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
  const patch = readSettings(await jsonBody(c))
  const settings = Object.keys(patch).length
    ? updateDeckSettings(deps.db, deckId, user.id, patch)
    : undefined
  return c.json({
    deck: deckView(getDeck(deps.db, deckId, user.id)!),
    settings: settings ? publicDeckSettings(settings) : undefined,
  })
}
