import { toGearSetId } from '../../ids'
import type { Context } from 'hono'
import { applyGearSet, removeGearSet, saveGearSet } from '../../services'
import type { App, AppEnv } from '../../context'
import { idField, jsonBody, oneOf, str } from '../body'
import { gearPayload } from './board'

export function registerSkillSets(app: App) {
  app.post('/api/skills/gear/sets', (c) => saveSetHandler(c))
  app.post('/api/skills/gear/sets/apply', (c) => applySetHandler(c))
  app.post('/api/skills/gear/sets/delete', (c) => deleteSetHandler(c))
}

const COMBAT_STYLES = ['melee', 'ranged', 'magic', 'general'] as const

async function saveSetHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const name = str(body, 'name')?.trim()
  if (!name) return c.json({ error: 'name required' }, 400)
  const set = saveGearSet(deps.db, user.id, name, oneOf(body, 'combatStyle', COMBAT_STYLES))
  return c.json({ set, ...gearPayload(deps, user.id) })
}

async function applySetHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const setId = idField(await jsonBody(c), 'setId', toGearSetId)
  if (!setId) return c.json({ error: 'setId required' }, 400)
  const res = applyGearSet(deps.db, deps.events, user.id, setId)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json({ ...gearPayload(deps, user.id), skipped: res.skipped })
}

async function deleteSetHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const setId = idField(await jsonBody(c), 'setId', toGearSetId)
  if (!setId) return c.json({ error: 'setId required' }, 400)
  removeGearSet(deps.db, user.id, setId)
  return c.json(gearPayload(deps, user.id))
}
