/**
 * Idle rig helpers (docs/DESIGN.md §13.5.1). Pure — no runes, no timers.
 *
 * The server is authoritative and settles on read; the client receives each
 * rig's rate and `runEndsAt` and extrapolates locally, then reconciles on the
 * next fetch. These helpers are that extrapolation, nothing more.
 */

import { craftsToItems, formatInterval } from '@tutor/core'
import type { IdleRigDTO, SkillDTO } from './skills'

/** `1 / 7s` — the compact rate label (shared with the server's curve). */
export const fmtInterval = formatInterval

/**
 * Extra items per produced item id made between `since` and `now`, clamped to
 * the end of the run. `since` is the moment the bank was fetched (the server's
 * settle cursor), so this is exactly what has accrued since we last looked.
 */
export function rigGainedSince(
  rig: IdleRigDTO | null,
  since: number,
  now: number,
): Record<string, number> {
  if (!rig?.active) return {}
  const end = Math.min(now, rig.runEndsAt)
  const dt = (end - since) / 1000
  if (dt <= 0 || rig.intervalSec <= 0) return {}
  return craftsToItems(dt / rig.intervalSec, rig.produces, 1 + rig.yieldBonus)
}

/** Whole seconds left in the run, live from the clock. */
export function rigSecondsLeft(rig: IdleRigDTO | null, now: number): number {
  if (!rig) return 0
  return Math.max(0, Math.round((rig.runEndsAt - now) / 1000))
}

/** `48m`, `1h 12m`, `6h`, `12s`. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (m === 0) return `${h}h`
  if (m === 60) return `${h + 1}h`
  return `${h}h ${m}m`
}

/**
 * For the bank: itemId → the first action whose rig is `active` and produces it.
 * Only the first claim wins, so a live figure has a single source.
 */
export function itemRigs(skills: SkillDTO[]): Map<string, IdleRigDTO> {
  const map = new Map<string, IdleRigDTO>()
  for (const s of skills) {
    for (const a of s.actions) {
      if (!a.idle?.active) continue
      for (const p of a.idle.produces) {
        if (!map.has(p.item)) map.set(p.item, a.idle)
      }
    }
  }
  return map
}
