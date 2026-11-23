/** Saved gear sets (docs/DESIGN.md §13.5.3). */

import type { Context } from 'hono'
import { applyGearSet, removeGearSet, saveGearSet } from '../../services'
import type { App, AppEnv } from '../../context'
import { gearPayload } from './board'

export function registerSkillSets(app: App) {
  app.post('/api/skills/gear/sets', (c) => saveSetHandler(c))
  app.post('/api/skills/gear/sets/apply', (c) => applySetHandler(c))
  app.post('/api/skills/gear/sets/delete', (c) => deleteSetHandler(c))
}

/** Save the current loadout as a named set. */
async function saveSetHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string
    combatStyle?: 'melee' | 'ranged' | 'magic' | 'general'
  }
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'name required' }, 400)
  const set = saveGearSet(deps.db, user.id, name, body.combatStyle)
  return c.json({ set, ...gearPayload(deps, user.id) })
}

/** Swap to a saved set. */
async function applySetHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { setId } = (await c.req.json().catch(() => ({}))) as { setId?: string }
  if (!setId) return c.json({ error: 'setId required' }, 400)
  const res = applyGearSet(deps.db, deps.events, user.id, setId)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json({ ...gearPayload(deps, user.id), skipped: res.skipped })
}

/** Delete a saved set. */
async function deleteSetHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { setId } = (await c.req.json().catch(() => ({}))) as { setId?: string }
  if (!setId) return c.json({ error: 'setId required' }, 400)
  removeGearSet(deps.db, user.id, setId)
  return c.json(gearPayload(deps, user.id))
}
