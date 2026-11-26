import type { UserId } from '../../ids'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { talents } from '../schema'
import { inTransaction } from './helpers'

export function listTalents(db: Db, userId: UserId) {
  return db.select().from(talents).where(eq(talents.userId, userId)).all()
}

export interface NewTalent {
  talentId: string
  skillId: string
  tier: string
  milestone: number
}

export function addTalent(db: Db, userId: UserId, t: NewTalent): void {
  db.insert(talents)
    .values({ userId, ...t })
    .onConflictDoNothing()
    .run()
}

export function replaceTalent(db: Db, userId: UserId, oldTalentId: string, t: NewTalent): void {
  inTransaction(db, (tx) => {
    tx.delete(talents)
      .where(and(eq(talents.userId, userId), eq(talents.talentId, oldTalentId)))
      .run()
    tx.insert(talents)
      .values({ userId, ...t })
      .run()
  })
}
