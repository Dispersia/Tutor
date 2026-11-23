/** Crafted gear: instances, equipping, salvage and enchanting (docs/DESIGN.md §13.5.3). */

import type { UserId, GearInstanceId } from '../ids'
import {
  addItems,
  countGearPieces,
  deleteGearInstance,
  getGearInstance,
  getItemCount,
  listEquipment,
  listGearInstances,
  setEquipment,
  setGearInstanceEnchant,
} from '../db/repo'
import type { Db } from '../db/client'
import { atomic } from '../db/repo/helpers'
import type { EventBus } from '../events'
import {
  gearScore,
  itemRequirements,
  meetsRequirements,
  parseStats,
  type MissingRequirement,
} from '../game/gear'
import {
  DISTILL_XP_PER_VALUE,
  ENCHANT_BY_ID,
  ITEM_BY_ID,
  SKILL_BY_ID,
  essenceFamily,
  essenceId,
  itemValue,
  slotFamily,
  type ArmourType,
  type Cost,
  type GearQuality,
  type GearStats,
  type ItemDef,
  type SkillId,
  type Slot,
} from '../game/skills'
import { bandForItem, parseEnchants } from './bands'
import { spareGearPiece } from './gearInstances'
import { consumeItems } from './items'
import { awardActionXp, skillLevelOf } from './progress'

export interface GearRequirementView extends MissingRequirement {
  /** Human skill name, e.g. `Defence`. */
  name: string
}

export interface GearInstanceView {
  id: GearInstanceId
  itemId: string
  slot: Slot
  quality: GearQuality
  stats: GearStats
  armour: number
  power: number
  gearScore: number
  equipped: boolean
  /** Enchant tokens on this piece: a band id, or `gem:<type>` (§13.5.3.1). */
  enchant: string[]
  /** Stat levels needed to wear this piece. */
  requirements: Partial<Record<SkillId, number>>
  /** Requirements the player does not meet yet (empty when wearable). */
  missing: GearRequirementView[]
}

/** Adds the human skill name to a missing requirement for the inventory UI. */
export function requirementView(missing: MissingRequirement[]): GearRequirementView[] {
  return missing.map((m) => ({ ...m, name: SKILL_BY_ID.get(m.skill)?.name ?? m.skill }))
}

/** Every crafted piece the player owns, with its rolled stats and wear state. */
export function gearView(db: Db, userId: UserId, levels?: Map<string, number>): GearInstanceView[] {
  const worn = wornSet(db, userId)
  const levelOf = (skill: SkillId) => skillLevelOf(db, userId, skill, levels)
  return listGearInstances(db, userId).map((row) => instanceView(row, worn, levelOf))
}

type GearRow = ReturnType<typeof listGearInstances>[number]

function instanceView(
  row: GearRow,
  worn: Set<GearInstanceId>,
  levelOf: (skill: SkillId) => number,
): GearInstanceView {
  const stats = parseStats(row.statsJson)
  return {
    id: row.id,
    itemId: row.itemId,
    slot: row.slot as Slot,
    quality: row.quality as GearQuality,
    stats,
    armour: row.armour,
    power: row.power,
    gearScore: gearScore(stats, row.armour, row.power),
    equipped: worn.has(row.id),
    enchant: parseEnchants(row.enchantJson),
    ...requirementsOf(ITEM_BY_ID.get(row.itemId), levelOf),
  }
}

/** The piece's stat requirements and whichever of them the player still misses. */
function requirementsOf(item: ItemDef | undefined, levelOf: (skill: SkillId) => number) {
  if (!item) return { requirements: {}, missing: [] }
  return {
    requirements: itemRequirements(item),
    missing: requirementView(meetsRequirements(item, levelOf).missing),
  }
}

/** The ids of the equipped pieces (the ones not free to re-wear). */
function wornSet(db: Db, userId: UserId): Set<GearInstanceId> {
  const ids = listEquipment(db, userId)
    .map((e) => e.instanceId)
    .filter((id): id is GearInstanceId => Boolean(id))
  return new Set(ids)
}

/**
 * Equips a piece: the named instance, or the first spare one of a bare item id.
 * Wearing moves nothing — a worn piece is still an instance, so the bank's
 * count of it (the number of instances) does not change.
 */
function equipItemTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  itemId: string,
  opts: { instanceId?: GearInstanceId; targetSlot?: string; levels?: Map<string, number> } = {},
): { ok: boolean; error?: string; instanceId?: GearInstanceId; missing?: GearRequirementView[] } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot) return { ok: false, error: 'not equippable' }
  // RuneScape-style gate: the piece's stat requirements must be met first.
  const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill, opts.levels))
  if (!gate.ok) return gateError(gate.missing)
  const slot = resolveSlot(item.slot, opts.targetSlot)
  const resolved = resolveInstance(db, userId, item, opts.instanceId)
  if ('error' in resolved) return { ok: false, error: resolved.error }
  vacateOtherSlots(db, userId, resolved.instance.id, slot)
  setEquipment(db, userId, slot, itemId, resolved.instance.id)
  bus.emit('item.equipped', { userId, itemId, slot })
  return { ok: true, instanceId: resolved.instance.id }
}

/** {@link equipItemTx}, all-or-nothing. */
export const equipItem = atomic(equipItemTx)

/** A piece is worn once: moving it to `slot` empties wherever else it sat. */
function vacateOtherSlots(db: Db, userId: UserId, instanceId: GearInstanceId, slot: string): void {
  for (const e of listEquipment(db, userId)) {
    if (e.instanceId === instanceId && e.slot !== slot) setEquipment(db, userId, e.slot, null)
  }
}

function gateError(missing: MissingRequirement[]) {
  const view = requirementView(missing)
  const names = view.map((m) => `${m.name} ${m.level}`).join(', ')
  return { ok: false as const, error: `requires ${names}`, missing: view }
}

/** The slot to wear in: the requested one when it fits the piece's family. */
function resolveSlot(itemSlot: Slot, targetSlot?: string): Slot {
  if (targetSlot && slotFamily(itemSlot).includes(targetSlot as Slot)) return targetSlot as Slot
  return itemSlot
}

type InstanceResult =
  { instance: NonNullable<ReturnType<typeof getGearInstance>> } | { error: string }

/** The rolled piece to wear: the named one, or a spare one of that item. */
function resolveInstance(
  db: Db,
  userId: UserId,
  item: ItemDef,
  instanceId?: GearInstanceId,
): InstanceResult {
  const given = instanceId ? getGearInstance(db, userId, instanceId) : undefined
  if (given) return given.itemId === item.id ? { instance: given } : { error: 'wrong item' }
  if (countGearPieces(db, userId, item.id) < 1) return { error: 'not in your bank' }
  const spare = spareGearPiece(db, userId, item.id)
  const instance = spare ? getGearInstance(db, userId, spare) : undefined
  return instance ? { instance } : { error: 'every piece is already worn' }
}

export function unequipItem(db: Db, userId: UserId, slot: string): void {
  const normalized = slot === 'weapon' ? 'mainHand' : slot === 'body' ? 'chest' : slot
  setEquipment(db, userId, normalized, null)
}

/** Removes a single crafted piece (not while worn). */
function discardGearTx(
  db: Db,
  userId: UserId,
  instanceId: GearInstanceId,
): { ok: boolean; error?: string } {
  const worn = listEquipment(db, userId).some((e) => e.instanceId === instanceId)
  if (worn) return { ok: false, error: 'unequip it first' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  deleteGearInstance(db, userId, instanceId)
  return { ok: true }
}

/** {@link discardGearTx}, all-or-nothing. */
export const discardGear = atomic(discardGearTx)

/** Materials returned by salvaging a piece, by armour family. */
const SALVAGE_MATERIAL: Record<ArmourType, string> = {
  plate: 'iron_ore',
  leather: 'hide',
  cloth: 'cloth',
  jewelry: 'cut_gem',
}

/** Salvage yield by quality: better pieces break into more material. */
const SALVAGE_YIELD: Record<GearQuality, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 5,
}

/**
 * Breaks a crafted piece back into crafting materials. The piece must be
 * unequipped. Higher quality rolls return more material.
 */
function salvageGearTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  instanceId: GearInstanceId,
): { ok: boolean; error?: string; materials?: Cost[] } {
  const worn = listEquipment(db, userId).some((e) => e.instanceId === instanceId)
  if (worn) return { ok: false, error: 'unequip it first' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  const item = ITEM_BY_ID.get(instance.itemId)
  if (!item) return { ok: false, error: 'unknown item' }
  const materials = salvageYield(item, instance.quality as GearQuality)
  deleteGearInstance(db, userId, instanceId)
  grantMaterials(db, bus, userId, materials)
  return { ok: true, materials }
}

/** {@link salvageGearTx}, all-or-nothing. */
export const salvageGear = atomic(salvageGearTx)

/** What a broken-down piece returns: its family material, plus the band reagent. */
function salvageYield(item: ItemDef, quality: GearQuality): Cost[] {
  const material = SALVAGE_MATERIAL[item.armourType ?? 'plate']
  const materials: Cost[] = [{ item: material, count: SALVAGE_YIELD[quality] ?? 1 }]
  // Deep salvage also yields the band's reagent (§13.5.3): the feedstock
  // Enchanting spends to put that band's signature stat on a higher-tier piece.
  const band = bandForItem(item)
  if (band) materials.push({ item: band.reagent, count: 1 })
  return materials
}

function grantMaterials(db: Db, bus: EventBus, userId: UserId, materials: Cost[]): void {
  for (const m of materials) {
    addItems(db, userId, m.item, m.count)
    bus.emit('item.gained', {
      userId,
      itemId: m.item,
      count: m.count,
      total: getItemCount(db, userId, m.item),
    })
  }
}

/**
 * Distill an item (§13.5.3.2): burn it to learn from it and pull out its family
 * essence. Enchanting XP is a **percentage of the item's coin value**, so an endgame
 * piece levels it faster but never instantly.
 */
function distillItemTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  itemId: string,
  count = 1,
): { ok: boolean; error?: string; xp?: number; essence?: string } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item) return { ok: false, error: 'unknown item' }
  const n = Math.max(1, Math.floor(count))
  if (getItemCount(db, userId, itemId) < n) return { ok: false, error: 'not in your bank' }
  // consuming equipment removes spare pieces first; a worn one is never burned
  if (item.slot && spareCount(db, userId, itemId) < n) return STILL_WORN
  consumeItems(db, bus, userId, [{ item: itemId, count: n }])
  const xp = Math.max(1, Math.round(itemValue(item) * DISTILL_XP_PER_VALUE)) * n
  awardActionXp(db, bus, userId, { actionId: 'distill', amount: xp })
  const essence = essenceId(essenceFamily(item))
  grantMaterials(db, bus, userId, [{ item: essence, count: n }])
  return { ok: true, xp, essence }
}

/** {@link distillItemTx}, all-or-nothing. */
export const distillItem = atomic(distillItemTx)

const STILL_WORN = { ok: false, error: 'unequip it first' }

/** How many pieces of an item are off the body, free to burn. */
function spareCount(db: Db, userId: UserId, itemId: string): number {
  const worn = wornSet(db, userId)
  return listGearInstances(db, userId).filter((g) => g.itemId === itemId && !worn.has(g.id)).length
}

/**
 * Apply an enchant to a crafted piece (§13.5.3.2). The enchant fits the piece's slot,
 * needs its Enchanting level, and costs its own essence reagents. It grants **no** XP
 * — the training is Distill; this is the payoff. One enchant per piece (replace).
 */
function applyEnchantTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  instanceId: GearInstanceId,
  opts: { enchantId: string; levels?: Map<string, number> },
): { ok: boolean; error?: string; enchantingLevel?: number } {
  const def = ENCHANT_BY_ID.get(opts.enchantId)
  if (!def) return { ok: false, error: 'unknown enchant' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  const invalid = enchantGuard(db, userId, def, ITEM_BY_ID.get(instance.itemId), opts.levels)
  if (invalid) return invalid
  consumeItems(db, bus, userId, def.reagents)
  setGearInstanceEnchant(db, userId, instanceId, JSON.stringify([def.id]))
  bus.emit('item.enchanted', { userId, instanceId, band: def.id })
  return { ok: true }
}

/** {@link applyEnchantTx}, all-or-nothing. */
export const applyEnchant = atomic(applyEnchantTx)

type EnchantDef = NonNullable<ReturnType<typeof ENCHANT_BY_ID.get>>

/** The reason the enchant cannot be applied, or undefined when it can. */
function enchantGuard(
  db: Db,
  userId: UserId,
  def: EnchantDef,
  item: ItemDef | undefined,
  levels?: Map<string, number>,
): { ok: false; error: string; enchantingLevel?: number } | undefined {
  if (!item?.slot || !(def.slot === item.slot || slotFamily(def.slot).includes(item.slot))) {
    return { ok: false, error: `${def.name} does not fit ${item?.slot ?? 'that piece'}` }
  }
  const level = skillLevelOf(db, userId, 'enchanting', levels)
  if (level < def.level) {
    return { ok: false, error: `requires Enchanting ${def.level}`, enchantingLevel: level }
  }
  const missing = def.reagents.filter((r) => getItemCount(db, userId, r.item) < r.count)
  if (missing.length) return { ok: false, error: `needs ${missing.map((m) => m.item).join(', ')}` }
  return undefined
}
