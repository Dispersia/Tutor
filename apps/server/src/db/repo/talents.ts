/** Chosen talents (per skill, per milestone). */

import { and, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { talents } from '../schema'
import { now } from './helpers'

export function listTalents(db: Db, userId: string) {
  return db.select().from(talents).where(eq(talents.userId, userId)).all()
}

export function hasTalent(db: Db, userId: string, talentId: string): boolean {
  const row = db
    .select()
    .from(talents)
    .where(and(eq(talents.userId, userId), eq(talents.talentId, talentId)))
    .get()
  return Boolean(row)
}

export interface NewTalent {
  talentId: string
  skillId: string
  tier: string
  milestone: number
}

export function addTalent(db: Db, userId: string, t: NewTalent): void {
  db.insert(talents)
    .values({ userId, ...t, grantedAt: now() })
    .onConflictDoNothing()
    .run()
}

export function removeTalent(db: Db, userId: string, talentId: string): void {
  db.delete(talents)
    .where(and(eq(talents.userId, userId), eq(talents.talentId, talentId)))
    .run()
}

/** Swaps an owned talent for a different one (respec at the same milestone). */
export function replaceTalent(db: Db, userId: string, oldTalentId: string, t: NewTalent): void {
  db.transaction((tx) => {
    tx.delete(talents)
      .where(and(eq(talents.userId, userId), eq(talents.talentId, oldTalentId)))
      .run()
    tx.insert(talents)
      .values({ userId, ...t, grantedAt: now() })
      .run()
  })
}
