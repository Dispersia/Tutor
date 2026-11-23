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
import { jsonBody, num, str } from '../body'
import { gearPayload } from './board'

/** The piece to equip: an exact instance, a base item, and where it goes. */
interface EquipPiece {
  itemId?: string
  instanceId?: string
  slot?: string
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
  const body = await jsonBody(c)
  const slot = str(body, 'slot')
  if (body.unequip && slot) {
    unequipItem(deps.db, user.id, slot)
    return c.json(gearPayload(deps, user.id))
  }
  return equipPiece(c, {
    itemId: str(body, 'itemId'),
    instanceId: str(body, 'instanceId'),
    slot,
  })
}

async function equipPiece(c: Context<AppEnv>, piece: EquipPiece) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const instance = piece.instanceId
    ? gearView(deps.db, user.id).find((g) => g.id === piece.instanceId)
    : undefined
  const itemId = piece.itemId ?? instance?.itemId
  if (!itemId) return c.json({ error: 'itemId or instanceId required' }, 400)
  const res = equipItem(deps.db, deps.events, user.id, itemId, {
    instanceId: instance?.id,
    targetSlot: piece.slot,
  })
  if (!res.ok) return c.json({ error: res.error, missing: res.missing }, 400)
  return c.json(gearPayload(deps, user.id))
}

/** Discard a crafted piece (must be unequipped first). */
async function discardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const instanceId = str(await jsonBody(c), 'instanceId')
  if (!instanceId) return c.json({ error: 'instanceId required' }, 400)
  const res = discardGear(deps.db, user.id, instanceId)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json(gearPayload(deps, user.id))
}

/** Salvage a crafted piece back into crafting materials. */
async function salvageHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const instanceId = str(await jsonBody(c), 'instanceId')
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
  const body = await jsonBody(c)
  const instanceId = str(body, 'instanceId')
  const enchantId = str(body, 'enchantId')
  if (!instanceId || !enchantId) {
    return c.json({ error: 'instanceId and enchantId required' }, 400)
  }
  const res = applyEnchant(deps.db, deps.events, user.id, instanceId, { enchantId })
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json(gearPayload(deps, user.id))
}

/** Distill an item: burn it for Enchanting XP (by value) and its family essence. */
async function distillHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const itemId = str(body, 'itemId')
  if (!itemId) return c.json({ error: 'itemId required' }, 400)
  const res = distillItem(deps.db, deps.events, user.id, itemId, num(body, 'count') ?? 1)
  if (!res.ok) return c.json({ error: res.error }, 400)
  return c.json({ xp: res.xp, essence: res.essence, ...gearPayload(deps, user.id) })
}
