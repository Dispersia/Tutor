/**
 * The drills the server has handed out, so a grade can only be taken for one of
 * them (docs/DESIGN.md §13.5: "material costs can't be bypassed by calling the
 * grader directly"). Without this a script could grade the easiest exercise on
 * one known card forever.
 *
 * In memory on purpose: a drill is answered within minutes, and after a restart
 * a member with a card still on screen has nothing recorded — that one grade is
 * let through rather than failing the review they were in the middle of.
 */

import type { UserId, CardId } from '../../ids'

interface Issued {
  cardId: string
  exerciseId: string
  at: number
}

/** A member can have a few drills open at once (two devices, a fight and a practice tab). */
const KEEP = 8
const TTL_MS = 60 * 60_000

const byUser = new Map<UserId, Issued[]>()

function live(userId: UserId, now: number): Issued[] {
  return (byUser.get(userId) ?? []).filter((d) => now - d.at < TTL_MS)
}

/** Records that this drill was served to the member. */
export function noteIssued(userId: UserId, drill: { cardId: string; exerciseId: string }): void {
  const now = Date.now()
  const rest = live(userId, now).filter(
    (d) => d.cardId !== drill.cardId || d.exerciseId !== drill.exerciseId,
  )
  byUser.set(userId, [...rest, { ...drill, at: now }].slice(-KEEP))
}

/** Whether the member may be graded on this drill (see the restart note above). */
export function wasIssued(userId: UserId, cardId: CardId, exerciseId: string): boolean {
  const open = live(userId, Date.now())
  if (open.length === 0) return true
  return open.some((d) => d.cardId === cardId && d.exerciseId === exerciseId)
}

/** When the drill was served, for a server-side time limit; undefined when unknown. */
export function issuedAt(userId: UserId, cardId: CardId, exerciseId: string): number | undefined {
  return live(userId, Date.now()).find((d) => d.cardId === cardId && d.exerciseId === exerciseId)
    ?.at
}
