/** The active combat encounter and the player's persisted HP. */

import { eq } from 'drizzle-orm'
import type { Db } from '../client'
import { encounters, playerState } from '../schema'
import { now } from './helpers'

export function getEncounter(db: Db, userId: string) {
  return db.select().from(encounters).where(eq(encounters.userId, userId)).get()
}

/** The columns a fight update may carry (the rest keep their stored value). */
export interface EncounterPatch {
  monsterId: string
  monsterHp: number
  playerHp: number
  playerMaxHp?: number
  monsterMaxHp?: number
  monsterDamage?: number
  monsterLevel?: number
  xpReward?: number
  powerBonus?: number
  potionId?: string | null
  foodEaten?: number
  totalDamage?: number
  xpEarned?: number
}

export function upsertEncounter(db: Db, userId: string, patch: EncounterPatch): void {
  const extras = encounterExtras(patch)
  db.insert(encounters)
    .values(encounterValues(userId, patch))
    .onConflictDoUpdate({
      target: encounters.userId,
      set: {
        monsterId: patch.monsterId,
        monsterHp: patch.monsterHp,
        playerHp: patch.playerHp,
        ...extras,
        updatedAt: now(),
      },
    })
    .run()
}

/** The insert values, with the columns the fight does not always set defaulted. */
function encounterValues(userId: string, patch: EncounterPatch) {
  return {
    userId,
    monsterId: patch.monsterId,
    monsterHp: patch.monsterHp,
    playerHp: patch.playerHp,
    playerMaxHp: patch.playerMaxHp ?? 0,
    powerBonus: patch.powerBonus ?? 0,
    potionId: patch.potionId ?? null,
    foodEaten: patch.foodEaten ?? 0,
    totalDamage: patch.totalDamage ?? 0,
    xpEarned: patch.xpEarned ?? 0,
    createdAt: now(),
    updatedAt: now(),
  }
}

/** Only the optional columns the patch actually carries, for the update set. */
function encounterExtras(patch: EncounterPatch) {
  return {
    ...(patch.playerMaxHp !== undefined ? { playerMaxHp: patch.playerMaxHp } : {}),
    ...(patch.monsterMaxHp !== undefined ? { monsterMaxHp: patch.monsterMaxHp } : {}),
    ...(patch.monsterDamage !== undefined ? { monsterDamage: patch.monsterDamage } : {}),
    ...(patch.monsterLevel !== undefined ? { monsterLevel: patch.monsterLevel } : {}),
    ...(patch.xpReward !== undefined ? { xpReward: patch.xpReward } : {}),
    ...(patch.powerBonus !== undefined ? { powerBonus: patch.powerBonus } : {}),
    ...(patch.potionId !== undefined ? { potionId: patch.potionId } : {}),
    ...(patch.foodEaten !== undefined ? { foodEaten: patch.foodEaten } : {}),
    ...(patch.totalDamage !== undefined ? { totalDamage: patch.totalDamage } : {}),
    ...(patch.xpEarned !== undefined ? { xpEarned: patch.xpEarned } : {}),
  }
}

export function clearEncounter(db: Db, userId: string): void {
  db.delete(encounters).where(eq(encounters.userId, userId)).run()
}

// --- persistent player state (combat HP) -------------------------------------

/** The player's persisted HP, or null when they have never fought (means "full"). */
export function getPlayerHp(db: Db, userId: string): number | null {
  return db.select().from(playerState).where(eq(playerState.userId, userId)).get()?.hp ?? null
}

export function setPlayerHp(db: Db, userId: string, hp: number): void {
  db.insert(playerState)
    .values({ userId, hp, updatedAt: now() })
    .onConflictDoUpdate({ target: playerState.userId, set: { hp, updatedAt: now() } })
    .run()
}
