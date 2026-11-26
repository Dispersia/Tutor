import { toDeckId } from '../../ids'
import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { deleteDeck, getDeck, updateDeckSettings } from '../../db/repo'
import { publicDeckSettings, type DeckSettings } from '../../deck/settings'
import { bool, jsonBody, obj, oneOf, str, strArray } from '../body'
import { deckView } from './view'
import { fail } from '../errors'

const VARIANTS = ['traditional', 'simplified'] as const

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

function deleteDeckHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = toDeckId(String(c.req.param('id')))
  const deck = getDeck(deps.db, deckId)
  if (!deck) return fail(c, 404, 'not found')
  if (user.role !== 'admin' && deck.userId !== user.id) {
    return fail(c, 403, 'Only the admin or the deck’s creator can delete a shared deck.')
  }
  deleteDeck(deps.db, deckId)
  return c.json({ ok: true, deckId })
}

async function patchDeckHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = toDeckId(String(c.req.param('id')))
  if (!getDeck(deps.db, deckId, user.id)) return fail(c, 404, 'not found')
  const patch = readSettings(await jsonBody(c))
  const settings = Object.keys(patch).length
    ? updateDeckSettings(deps.db, deckId, patch, user.id)
    : undefined
  return c.json({
    deck: deckView(getDeck(deps.db, deckId)!),
    settings: settings ? publicDeckSettings(settings) : undefined,
  })
}
