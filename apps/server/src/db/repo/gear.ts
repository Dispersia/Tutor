/** Worn equipment, crafted gear instances and saved gear sets. */

import { and, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { equipment, gearInstances, gearSets } from '../schema'
import { id, now } from './helpers'

export function listEquipment(db: Db, userId: string) {
  return db.select().from(equipment).where(eq(equipment.userId, userId)).all()
}

export function setEquipment(
  db: Db,
  userId: string,
  slot: string,
  itemId: string | null,
  instanceId: string | null = null,
): void {
  if (itemId === null) {
    db.delete(equipment)
      .where(and(eq(equipment.userId, userId), eq(equipment.slot, slot)))
      .run()
    return
  }
  db.insert(equipment)
    .values({ userId, slot, itemId, instanceId, updatedAt: now() })
    .onConflictDoUpdate({
      target: [equipment.userId, equipment.slot],
      set: { itemId, instanceId, updatedAt: now() },
    })
    .run()
}

// --- crafted gear instances + saved sets -------------------------------------

export interface GearInstanceRow {
  id: string
  userId: string
  itemId: string
  slot: string
  quality: string
  statsJson: string
  /** JSON array of band ids enchanted onto the piece (docs §13.5.3). */
  enchantJson: string
  armour: number
  power: number
  createdAt: number
}

export function listGearInstances(db: Db, userId: string) {
  return db.select().from(gearInstances).where(eq(gearInstances.userId, userId)).all()
}

export function getGearInstance(db: Db, userId: string, id: string) {
  return db
    .select()
    .from(gearInstances)
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.id, id)))
    .get()
}

export function addGearInstance(
  db: Db,
  row: Omit<GearInstanceRow, 'id' | 'createdAt' | 'enchantJson'> & {
    id?: string
    createdAt?: number
    enchantJson?: string
  },
): string {
  const gearId = row.id ?? id()
  db.insert(gearInstances)
    .values({
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
    })
    .run()
  return gearId
}

/** Replaces a piece's enchant list (a JSON array of band ids). */
export function setGearInstanceEnchant(
  db: Db,
  userId: string,
  id: string,
  enchantJson: string,
): void {
  db.update(gearInstances)
    .set({ enchantJson })
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.id, id)))
    .run()
}

export function deleteGearInstance(db: Db, userId: string, id: string): void {
  db.delete(gearInstances)
    .where(and(eq(gearInstances.userId, userId), eq(gearInstances.id, id)))
    .run()
}

export function listGearSets(db: Db, userId: string) {
  return db.select().from(gearSets).where(eq(gearSets.userId, userId)).all()
}

export function addGearSet(
  db: Db,
  row: {
    userId: string
    name: string
    combatStyle: string
    slotsJson: string
  },
): string {
  const setId = id()
  const stamp = now()
  db.insert(gearSets)
    .values({
      id: setId,
      userId: row.userId,
      name: row.name,
      combatStyle: row.combatStyle,
      slotsJson: row.slotsJson,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .run()
  return setId
}

export function updateGearSet(
  db: Db,
  userId: string,
  setId: string,
  patch: { name?: string; combatStyle?: string; slotsJson?: string },
): void {
  db.update(gearSets)
    .set({ ...patch, updatedAt: now() })
    .where(and(eq(gearSets.userId, userId), eq(gearSets.id, setId)))
    .run()
}

export function deleteGearSet(db: Db, userId: string, setId: string): void {
  db.delete(gearSets)
    .where(and(eq(gearSets.userId, userId), eq(gearSets.id, setId)))
    .run()
}
