import { toDeckId } from '../../ids'
import type { Context } from 'hono'
import type { App, AppEnv } from '../../context'
import { getDeck } from '../../db/repo'
import { applyAudit, scanDeck } from '../../deck/audit'
import { bool, jsonBody } from '../body'
import { fail } from '../errors'

export function registerDeckAudit(app: App) {
  app.post('/api/decks/:id/audit', (c) => auditHandler(c))
}

async function auditHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = toDeckId(String(c.req.param('id')))
  if (!getDeck(deps.db, deckId, user.id)) return fail(c, 404, 'not found')
  const apply = bool(await jsonBody(c), 'apply') === true
  const audit = await scanDeck(deps.db, user.id, deckId)
  const applied = apply ? applyAudit(deps.db, audit.issues) : undefined
  return c.json({ checked: audit.checked, issues: audit.issues, applied })
}
