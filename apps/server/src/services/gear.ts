/** Crafted gear: instances, equipping, salvage and enchanting (docs/DESIGN.md §13.5.3). */

import {
  addItems,
  deleteGearInstance,
  getGearInstance,
  getItemCount,
  listEquipment,
  listGearInstances,
  setEquipment,
  setGearInstanceEnchant,
} from '../db/repo'
import type { Db } from '../db/client'
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
import { ensureBaseGearInstance } from './gearInstances'
import { consumeItems } from './items'
import { awardActionXp, skillLevelOf } from './progress'

export interface GearRequirementView extends MissingRequirement {
  /** Human skill name, e.g. `Defence`. */
  name: string
}

export interface GearInstanceView {
  id: string
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

/**
 * Older equipment rows predate gear instances. Give every worn piece a base
 * instance once, so the paper doll and saved sets can show its stats.
 */
export function ensureWornGear(db: Db, userId: string): void {
  for (const row of listEquipment(db, userId)) {
    if (row.instanceId) continue
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item?.slot) continue
    const id = ensureBaseGearInstance(db, userId, item)
    setEquipment(db, userId, row.slot, row.itemId, id)
  }
}

/** Every crafted piece the player owns, with its rolled stats and wear state. */
export function gearView(db: Db, userId: string, levels?: Map<string, number>): GearInstanceView[] {
  ensureWornGear(db, userId)
  const worn = wornSet(db, userId)
  const levelOf = (skill: SkillId) => skillLevelOf(db, userId, skill, levels)
  return listGearInstances(db, userId).map((row) => instanceView(row, worn, levelOf))
}

type GearRow = ReturnType<typeof listGearInstances>[number]

function instanceView(
  row: GearRow,
  worn: Set<string>,
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
function wornSet(db: Db, userId: string): Set<string> {
  const ids = listEquipment(db, userId)
    .map((e) => e.instanceId)
    .filter((id): id is string => Boolean(id))
  return new Set(ids)
}

/** The first unequipped instance of an item, if one exists. */
function findFreeGear(db: Db, userId: string, itemId: string): string | undefined {
  const worn = wornSet(db, userId)
  return listGearInstances(db, userId).find((g) => g.itemId === itemId && !worn.has(g.id))?.id
}

/**
 * Equips a piece. Crafted gear equips by instance so its rolled stats follow it;
 * legacy gear (or a bare item id) equips the first free instance, or creates one
 * from the base definition. The inventory count stays as "pieces owned".
 */
export function equipItem(
  db: Db,
  bus: EventBus,
  userId: string,
  itemId: string,
  instanceId?: string,
  targetSlot?: string,
  levels?: Map<string, number>,
): { ok: boolean; error?: string; instanceId?: string; missing?: GearRequirementView[] } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot) return { ok: false, error: 'not equippable' }
  // RuneScape-style gate: the piece's stat requirements must be met first.
  const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill, levels))
  if (!gate.ok) return gateError(gate.missing)
  const slot = resolveSlot(item.slot, targetSlot)
  const resolved = resolveInstance(db, userId, item, instanceId)
  if ('error' in resolved) return { ok: false, error: resolved.error }
  setEquipment(db, userId, slot, itemId, resolved.instance?.id ?? null)
  bus.emit('item.equipped', { userId, itemId, slot })
  return { ok: true, instanceId: resolved.instance?.id }
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

type InstanceResult = { instance?: ReturnType<typeof getGearInstance> } | { error: string }

/** The rolled piece to wear: the named one, a free one, or a fresh base piece. */
function resolveInstance(
  db: Db,
  userId: string,
  item: ItemDef,
  instanceId?: string,
): InstanceResult {
  const given = instanceId ? getGearInstance(db, userId, instanceId) : undefined
  if (given) return given.itemId === item.id ? { instance: given } : { error: 'wrong item' }
  const owned = listGearInstances(db, userId).filter((g) => g.itemId === item.id)
  if (owned.length > 0) {
    const free = findFreeGear(db, userId, item.id)
    if (!free) return { error: 'every piece is already worn' }
    return { instance: getGearInstance(db, userId, free) }
  }
  if (getItemCount(db, userId, item.id) < 1) return { error: 'not in your bank' }
  return { instance: getGearInstance(db, userId, ensureBaseGearInstance(db, userId, item)) }
}

export function unequipItem(db: Db, userId: string, slot: string): void {
  const normalized = slot === 'weapon' ? 'mainHand' : slot === 'body' ? 'chest' : slot
  setEquipment(db, userId, normalized, null)
}

/** Removes a single crafted piece (not while worn). */
export function discardGear(
  db: Db,
  userId: string,
  instanceId: string,
): { ok: boolean; error?: string } {
  const worn = listEquipment(db, userId).some((e) => e.instanceId === instanceId)
  if (worn) return { ok: false, error: 'unequip it first' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  deleteGearInstance(db, userId, instanceId)
  addItems(db, userId, instance.itemId, -1)
  return { ok: true }
}

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
export function salvageGear(
  db: Db,
  bus: EventBus,
  userId: string,
  instanceId: string,
): { ok: boolean; error?: string; materials?: Cost[] } {
  const worn = listEquipment(db, userId).some((e) => e.instanceId === instanceId)
  if (worn) return { ok: false, error: 'unequip it first' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  const item = ITEM_BY_ID.get(instance.itemId)
  if (!item) return { ok: false, error: 'unknown item' }
  const materials = salvageYield(item, instance.quality as GearQuality)
  deleteGearInstance(db, userId, instanceId)
  addItems(db, userId, instance.itemId, -1)
  grantMaterials(db, bus, userId, materials)
  return { ok: true, materials }
}

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

function grantMaterials(db: Db, bus: EventBus, userId: string, materials: Cost[]): void {
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
export function distillItem(
  db: Db,
  bus: EventBus,
  userId: string,
  itemId: string,
  count = 1,
): { ok: boolean; error?: string; xp?: number; essence?: string } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item) return { ok: false, error: 'unknown item' }
  const n = Math.max(1, Math.floor(count))
  if (getItemCount(db, userId, itemId) < n) return { ok: false, error: 'not in your bank' }
  consumeItems(db, bus, userId, [{ item: itemId, count: n }])
  const xp = Math.max(1, Math.round(itemValue(item) * DISTILL_XP_PER_VALUE)) * n
  awardActionXp(db, bus, userId, { actionId: 'distill', amount: xp })
  const essence = essenceId(essenceFamily(item))
  grantMaterials(db, bus, userId, [{ item: essence, count: n }])
  return { ok: true, xp, essence }
}

/**
 * Apply an enchant to a crafted piece (§13.5.3.2). The enchant fits the piece's slot,
 * needs its Enchanting level, and costs its own essence reagents. It grants **no** XP
 * — the training is Distill; this is the payoff. One enchant per piece (replace).
 */
export function applyEnchant(
  db: Db,
  bus: EventBus,
  userId: string,
  instanceId: string,
  enchantId: string,
  levels?: Map<string, number>,
): { ok: boolean; error?: string; enchantingLevel?: number } {
  const def = ENCHANT_BY_ID.get(enchantId)
  if (!def) return { ok: false, error: 'unknown enchant' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  const invalid = enchantGuard(db, userId, def, ITEM_BY_ID.get(instance.itemId), levels)
  if (invalid) return invalid
  consumeItems(db, bus, userId, def.reagents)
  setGearInstanceEnchant(db, userId, instanceId, JSON.stringify([def.id]))
  bus.emit('item.enchanted', { userId, instanceId, band: def.id })
  return { ok: true }
}

type EnchantDef = NonNullable<ReturnType<typeof ENCHANT_BY_ID.get>>

/** The reason the enchant cannot be applied, or undefined when it can. */
function enchantGuard(
  db: Db,
  userId: string,
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
