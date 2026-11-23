import type { UserId, GearInstanceId, GearSetId } from '../../ids'
import { and, count, eq, isNull } from 'drizzle-orm'
import { rollGearStats, statsOf } from '../../game/gear'
import type { ItemDef } from '../../game/skills'
import type { Db } from '../client'
import { equipment, gearInstances, gearSets } from '../schema'
import { newId, now } from './helpers'

export function listEquipment(db: Db, userId: UserId) {
  return db.select().from(equipment).where(eq(equipment.userId, userId)).all()
}

export function setEquipment(
  db: Db,
  userId: UserId,
  slot: string,
  itemId: string | null,
  instanceId: GearInstanceId | null = null,
): void {
  if (itemId === null) return clearEquipment(db, userId, slot)
  db.insert(equipment)
    .values({ userId, slot, itemId, instanceId, updatedAt: now() })
    .onConflictDoUpdate({
      target: [equipment.userId, equipment.slot],
      set: { itemId, instanceId, updatedAt: now() },
    })
    .run()
}

function clearEquipment(db: Db, userId: UserId, slot: string): void {
  db.delete(equipment)
    .where(and(eq(equipment.userId, userId), eq(equipment.slot, slot)))
    .run()
}

export interface GearInstanceRow {
  id: GearInstanceId
  userId: UserId
  itemId: string
  slot: string
  quality: string
  statsJson: string
  enchantJson: string
  armour: number
  power: number
  createdAt: number
}

export function listGearInstances(db: Db, userId: UserId) {
  return db.select().from(gearInstances).where(eq(gearInstances.userId, userId)).all()
}

export function getGearInstance(db: Db, userId: UserId, id: GearInstanceId) {
  return db
    .select()
    .from(gearInstances)
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.id, id)))
    .get()
}

export type NewGearInstance = Omit<GearInstanceRow, 'id' | 'createdAt' | 'enchantJson'> & {
  id?: GearInstanceId
  createdAt?: number
  enchantJson?: string
}

export function addGearInstance(db: Db, row: NewGearInstance): GearInstanceId {
  const gearId = row.id ?? newId<GearInstanceId>()
  db.insert(gearInstances).values(gearValues(gearId, row)).run()
  return gearId
}

function gearValues(gearId: GearInstanceId, row: NewGearInstance) {
  return {
    id: gearId,
    userId: row.userId,
    itemId: row.itemId,
    slot: row.slot,
    quality: row.quality,
    statsJson: row.statsJson,
    enchantJson: row.enchantJson ?? '[]',
    armour: row.armour,
    power: row.power,
    createdAt: row.createdAt ?? now(),
  }
}

export function setGearInstanceEnchant(
  db: Db,
  userId: UserId,
  id: GearInstanceId,
  enchantJson: string,
): void {
  db.update(gearInstances)
    .set({ enchantJson })
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.id, id)))
    .run()
}

export function deleteGearInstance(db: Db, userId: UserId, id: GearInstanceId): void {
  db.delete(gearInstances)
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.id, id)))
    .run()
}

export function countGearPieces(db: Db, userId: UserId, itemId: string): number {
  const row = db
    .select({ n: count() })
    .from(gearInstances)
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.itemId, itemId)))
    .get()
  return row?.n ?? 0
}

export function addGearPiece(
  db: Db,
  userId: UserId,
  item: ItemDef,
  rand?: () => number,
): GearInstanceId {
  const roll = rand
    ? rollGearStats(item, rand)
    : { quality: 'common', stats: statsOf(item), armour: item.armour ?? 0, power: item.power ?? 0 }
  return addGearInstance(db, {
    userId,
    itemId: item.id,
    slot: item.slot!,
    quality: roll.quality,
    statsJson: JSON.stringify(roll.stats),
    armour: roll.armour,
    power: roll.power,
  })
}

const QUALITY_ORDER: readonly string[] = ['common', 'uncommon', 'rare', 'epic']

export function removeGearPieces(db: Db, userId: UserId, itemId: string, n: number): void {
  const rank = (g: { quality: string }) => QUALITY_ORDER.indexOf(g.quality)
  const spare = spareGearPieces(db, userId, itemId).sort((a, b) => rank(a) - rank(b))
  for (const g of spare.slice(0, Math.max(0, n))) deleteGearInstance(db, userId, g.id)
}

export function spareGearPieces(db: Db, userId: UserId, itemId: string) {
  const worn = new Set(listEquipment(db, userId).map((e) => e.instanceId))
  return listGearInstances(db, userId).filter((g) => g.itemId === itemId && !worn.has(g.id))
}

export function listUnlinkedEquipment(db: Db) {
  return db.select().from(equipment).where(isNull(equipment.instanceId)).all()
}

export function listGearSets(db: Db, userId: UserId) {
  return db.select().from(gearSets).where(eq(gearSets.userId, userId)).all()
}

export interface NewGearSet {
  userId: UserId
  name: string
  combatStyle: string
  slotsJson: string
}

export function addGearSet(db: Db, row: NewGearSet): GearSetId {
  const setId = newId<GearSetId>()
  const stamp = now()
  db.insert(gearSets)
    .values({ id: setId, ...row, createdAt: stamp, updatedAt: stamp })
    .run()
  return setId
}

export function deleteGearSet(db: Db, userId: UserId, setId: GearSetId): void {
  db.delete(gearSets)
    .where(and(eq(gearSets.userId, userId), eq(gearSets.id, setId)))
    .run()
}
