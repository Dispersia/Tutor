import { toGearInstanceId, type GearInstanceId } from '../../ids'
import type { Context } from 'hono'
import {
  applyEnchant,
  discardGear,
  distillItem,
  distillMode,
  equipItem,
  gearView,
  salvageGear,
  setDistillMode,
  toggleDistillItem,
  unequipItem,
} from '../../services'
import type { App, AppEnv } from '../../context'
import { idField, jsonBody, num, str } from '../body'
import { fail } from '../errors'
import { gearPayload } from './board'

interface EquipPiece {
  itemId?: string
  instanceId?: GearInstanceId
  slot?: string
}

export function registerSkillGear(app: App) {
  app.get('/api/skills/gear', (c) => gearHandler(c))
  app.post('/api/skills/equip', (c) => equipHandler(c))
  app.post('/api/skills/gear/discard', (c) => discardHandler(c))
  app.post('/api/skills/gear/salvage', (c) => salvageHandler(c))
  app.post('/api/skills/gear/enchant', (c) => enchantHandler(c))
  app.post('/api/skills/gear/distill', (c) => distillHandler(c))
  app.post('/api/skills/gear/distill/mode', (c) => distillModeHandler(c))
  app.post('/api/skills/gear/distill/toggle', (c) => distillToggleHandler(c))
}

function gearHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  return c.json(gearPayload(deps, user.id))
}

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
    instanceId: idField(body, 'instanceId', toGearInstanceId),
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
  if (!itemId) return fail(c, 400, 'itemId or instanceId required')
  const res = equipItem(deps.db, deps.events, user.id, itemId, {
    instanceId: instance?.id,
    targetSlot: piece.slot,
  })
  if (!res.ok) return fail(c, 400, res.error!, { missing: res.missing })
  return c.json(gearPayload(deps, user.id))
}

async function discardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const instanceId = idField(await jsonBody(c), 'instanceId', toGearInstanceId)
  if (!instanceId) return fail(c, 400, 'instanceId required')
  const res = discardGear(deps.db, user.id, instanceId)
  if (!res.ok) return fail(c, 400, res.error!)
  return c.json(gearPayload(deps, user.id))
}

async function salvageHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const instanceId = idField(await jsonBody(c), 'instanceId', toGearInstanceId)
  if (!instanceId) return fail(c, 400, 'instanceId required')
  const res = salvageGear(deps.db, deps.events, user.id, instanceId)
  if (!res.ok) return fail(c, 400, res.error!)
  return c.json({ materials: res.materials, ...gearPayload(deps, user.id) })
}

async function enchantHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const instanceId = idField(body, 'instanceId', toGearInstanceId)
  const enchantId = str(body, 'enchantId')
  if (!instanceId || !enchantId) {
    return fail(c, 400, 'instanceId and enchantId required')
  }
  const res = applyEnchant(deps.db, deps.events, user.id, instanceId, { enchantId })
  if (!res.ok) return fail(c, 400, res.error!)
  return c.json(gearPayload(deps, user.id))
}

async function distillHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const itemId = str(body, 'itemId')
  if (!itemId) return fail(c, 400, 'itemId required')
  const res = distillItem(deps.db, deps.events, user.id, itemId, num(body, 'count') ?? 1)
  if (!res.ok) return fail(c, 400, res.error!)
  return c.json({ xp: res.xp, essence: res.essence, ...gearPayload(deps, user.id) })
}

async function distillModeHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const mode = distillMode(str(await jsonBody(c), 'mode') ?? '')
  if (!mode) return fail(c, 400, 'unknown mode')
  setDistillMode(deps.db, user.id, mode)
  return c.json(gearPayload(deps, user.id))
}

async function distillToggleHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const itemId = str(await jsonBody(c), 'itemId')
  if (!itemId) return fail(c, 400, 'itemId required')
  toggleDistillItem(deps.db, user.id, itemId)
  return c.json(gearPayload(deps, user.id))
}
