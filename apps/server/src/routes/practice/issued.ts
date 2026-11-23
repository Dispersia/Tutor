import type { UserId, CardId } from '../../ids'

interface Issued {
  cardId: string
  exerciseId: string
  at: number
}

const KEEP = 8
const TTL_MS = 60 * 60_000

const byUser = new Map<UserId, Issued[]>()

function live(userId: UserId, now: number): Issued[] {
  return (byUser.get(userId) ?? []).filter((d) => now - d.at < TTL_MS)
}

export function noteIssued(userId: UserId, drill: { cardId: string; exerciseId: string }): void {
  const now = Date.now()
  const rest = live(userId, now).filter(
    (d) => d.cardId !== drill.cardId || d.exerciseId !== drill.exerciseId,
  )
  byUser.set(userId, [...rest, { ...drill, at: now }].slice(-KEEP))
}

export function wasIssued(userId: UserId, cardId: CardId, exerciseId: string): boolean {
  const open = live(userId, Date.now())
  if (open.length === 0) return true
  return open.some((d) => d.cardId === cardId && d.exerciseId === exerciseId)
}

export function issuedAt(userId: UserId, cardId: CardId, exerciseId: string): number | undefined {
  return live(userId, Date.now()).find((d) => d.cardId === cardId && d.exerciseId === exerciseId)
    ?.at
}
