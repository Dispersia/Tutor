/** Gear actions: equip, discard, salvage, enchant, distill (docs/DESIGN.md §13.5.3). */

import type { Context } from 'hono'
import {
  applyEnchant,
  discardGear,
  distillItem,
  equipItem,
  gearView,
  salvageGear,
  unequipItem,
} from '../../services'
import type { App, AppEnv } from '../../context'
import { gearPayload } from './board'

interface EquipBody {
  itemId?: string
  instanceId?: string
  slot?: string
  unequip?: boolean
}

export function registerSkillGear(app: App) {
  app.get('/api/skills/gear', (c) => gearHandler(c))
  app.post('/api/skills/equip', (c) => equipHandler(c))
  app.post('/api/skills/gear/discard', (c) => discardHandler(c))
  app.post('/api/skills/gear/salvage', (c) => salvageHandler(c))
  app.post('/api/skills/gear/enchant', (c) => enchantHandler(c))
  app.post('/api/skills/gear/distill', (c) => distillHandler(c))
}

/** The gear screen: worn rows, rolled instances and saved sets. */
function gearHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  return c.json(gearPayload(deps, user.id))
}

/**
 * Equip / unequip gear. An instanceId equips that exact rolled piece; an itemId
 * equips the first free instance (or creates one from the base definition).
 */
async function equipHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = (await c.req.json().catch(() => ({}))) as EquipBody
  if (body.unequip && body.slot) {
    unequipItem(deps.db, user.id, body.slot)
    return c.json(gearPayload(deps, user.id))
  }
  return equipPiece(c, body)
}

async function equipPiece(c: Context<AppEnv>, body: EquipBody) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const instance = body.instanceId
    ? gearView(deps.db, user.id).find((g) => g.id === body.instanceId)
    : undefined
  const itemId = body.itemId ?? instance?.itemId
  if (!itemId) return c.json({ error: 'itemId or instanceId required' }, 400)
  const res = equipItem(deps.db, deps.events, user.id, itemId, instance?.id, body.slot)
  if (!res.ok) return c.json({ error: res.error, missing: res.missing }, 400)
  return c.json(gearPayload(deps, user.id))
}

/** Discard a crafted piece (must be unequipped first). */
async function discardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { instanceId } = (await c.req.json().catch(() => ({}))) as { instanceId?: string }
  if (!instanceId) return c.json({ error: 'instanceId required' }, 400)
  const res = discardGear(deps.db, user.id, instanceId)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json(gearPayload(deps, user.id))
}

/** Salvage a crafted piece back into crafting materials. */
async function salvageHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { instanceId } = (await c.req.json().catch(() => ({}))) as { instanceId?: string }
  if (!instanceId) return c.json({ error: 'instanceId required' }, 400)
  const res = salvageGear(deps.db, deps.events, user.id, instanceId)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json({ materials: res.materials, ...gearPayload(deps, user.id) })
}

/**
 * Enchant a crafted piece (§13.5.3.2): pick a catalog enchant that fits its slot,
 * spend its essence reagents. Applying grants no XP — Distill is the training.
 */
async function enchantHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { instanceId, enchantId } = (await c.req.json().catch(() => ({}))) as {
    instanceId?: string
    enchantId?: string
  }
  if (!instanceId || !enchantId) {
    return c.json({ error: 'instanceId and enchantId required' }, 400)
  }
  const res = applyEnchant(deps.db, deps.events, user.id, instanceId, enchantId)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json(gearPayload(deps, user.id))
}

/** Distill an item: burn it for Enchanting XP (by value) and its family essence. */
async function distillHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { itemId, count } = (await c.req.json().catch(() => ({}))) as {
    itemId?: string
    count?: number
  }
  if (!itemId) return c.json({ error: 'itemId required' }, 400)
  const res = distillItem(deps.db, deps.events, user.id, itemId, count ?? 1)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json({ xp: res.xp, essence: res.essence, ...gearPayload(deps, user.id) })
}
