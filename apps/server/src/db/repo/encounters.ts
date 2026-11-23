import type { UserId } from '../../ids'
import { eq } from 'drizzle-orm'
import type { Db } from '../client'
import { encounters, playerState } from '../schema'
import { now } from './helpers'

export function getEncounter(db: Db, userId: UserId) {
  return db.select().from(encounters).where(eq(encounters.userId, userId)).get()
}

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

export function upsertEncounter(db: Db, userId: UserId, patch: EncounterPatch): void {
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

function encounterValues(userId: UserId, patch: EncounterPatch) {
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

export function clearEncounter(db: Db, userId: UserId): void {
  db.delete(encounters).where(eq(encounters.userId, userId)).run()
}

export function getPlayerHp(db: Db, userId: UserId): number | null {
  return db.select().from(playerState).where(eq(playerState.userId, userId)).get()?.hp ?? null
}

export function setPlayerHp(db: Db, userId: UserId, hp: number): void {
  db.insert(playerState)
    .values({ userId, hp, updatedAt: now() })
    .onConflictDoUpdate({ target: playerState.userId, set: { hp, updatedAt: now() } })
    .run()
}
