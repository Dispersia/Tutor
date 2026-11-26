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
  spareGearPieceId,
  spareGearPieces,
  wornGearIds,
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
  ENCHANT_BY_ID,
  ITEM_BY_ID,
  SKILL_BY_ID,
  essenceFamily,
  essenceId,
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
import { distillXp } from './distill'
import { consumeItems } from './items'
import { awardActionXp, skillLevelOf } from './progress'

export interface GearRequirementView extends MissingRequirement {
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
  enchant: string[]
  requirements: Partial<Record<SkillId, number>>
  missing: GearRequirementView[]
}

export function requirementView(missing: MissingRequirement[]): GearRequirementView[] {
  return missing.map((m) => ({ ...m, name: SKILL_BY_ID.get(m.skill)?.name ?? m.skill }))
}

export function gearView(db: Db, userId: UserId, levels?: Map<string, number>): GearInstanceView[] {
  const worn = wornGearIds(db, userId)
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

function requirementsOf(item: ItemDef | undefined, levelOf: (skill: SkillId) => number) {
  if (!item) return { requirements: {}, missing: [] }
  return {
    requirements: itemRequirements(item),
    missing: requirementView(meetsRequirements(item, levelOf).missing),
  }
}

function equipItemTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  itemId: string,
  opts: { instanceId?: GearInstanceId; targetSlot?: string; levels?: Map<string, number> } = {},
): { ok: boolean; error?: string; instanceId?: GearInstanceId; missing?: GearRequirementView[] } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot) return { ok: false, error: 'not equippable' }
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

export const equipItem = atomic(equipItemTx)

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

function resolveSlot(itemSlot: Slot, targetSlot?: string): Slot {
  if (targetSlot && slotFamily(itemSlot).includes(targetSlot as Slot)) return targetSlot as Slot
  return itemSlot
}

type InstanceResult =
  { instance: NonNullable<ReturnType<typeof getGearInstance>> } | { error: string }

function resolveInstance(
  db: Db,
  userId: UserId,
  item: ItemDef,
  instanceId?: GearInstanceId,
): InstanceResult {
  const given = instanceId ? getGearInstance(db, userId, instanceId) : undefined
  if (given) return given.itemId === item.id ? { instance: given } : { error: 'wrong item' }
  if (countGearPieces(db, userId, item.id) < 1) return { error: 'not in your bank' }
  const spare = spareGearPieceId(db, userId, item.id)
  const instance = spare ? getGearInstance(db, userId, spare) : undefined
  return instance ? { instance } : { error: 'every piece is already worn' }
}

export function unequipItem(db: Db, userId: UserId, slot: string): void {
  const normalized = slot === 'weapon' ? 'mainHand' : slot === 'body' ? 'chest' : slot
  setEquipment(db, userId, normalized, null)
}

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

export const discardGear = atomic(discardGearTx)

const SALVAGE_MATERIAL: Record<ArmourType, string> = {
  plate: 'iron_ore',
  leather: 'hide',
  cloth: 'cloth',
  jewelry: 'cut_gem',
}

const SALVAGE_YIELD: Record<GearQuality, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 5,
}

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

export const salvageGear = atomic(salvageGearTx)

function salvageYield(item: ItemDef, quality: GearQuality): Cost[] {
  const material = SALVAGE_MATERIAL[item.armourType ?? 'plate']
  const materials: Cost[] = [{ item: material, count: SALVAGE_YIELD[quality] ?? 1 }]
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
  if (item.slot && spareCount(db, userId, itemId) < n) return STILL_WORN
  consumeItems(db, bus, userId, [{ item: itemId, count: n }])
  const xp = distillXp(item) * n
  awardActionXp(db, bus, userId, { actionId: 'distill', amount: xp })
  const essence = essenceId(essenceFamily(item))
  grantMaterials(db, bus, userId, [{ item: essence, count: n }])
  return { ok: true, xp, essence }
}

export const distillItem = atomic(distillItemTx)

const STILL_WORN = { ok: false, error: 'unequip it first' }

function spareCount(db: Db, userId: UserId, itemId: string): number {
  return spareGearPieces(db, userId, itemId).length
}

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

export const applyEnchant = atomic(applyEnchantTx)

type EnchantDef = NonNullable<ReturnType<typeof ENCHANT_BY_ID.get>>

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
