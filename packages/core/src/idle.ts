/**
 * The idle-rig curve (docs/DESIGN.md §13.5.1) — shared by the server engine and
 * the client's local extrapolation, so the two can never drift.
 *
 * Pure maths only: no database, no timers, no DOM.
 */

/**
 * The curve. All values are seconds except `xpPerCraft`. Tune here — nothing
 * else in the engine holds a magic number.
 */
export const IDLE = {
  /** seconds per item at zero completions */
  firstIntervalSec: 10,
  /** the fastest a rig ever runs */
  floorIntervalSec: 2,
  /** completions needed to halve the distance to `floorIntervalSec` */
  intervalHalfLife: 15,
  /** seconds a run lasts after the first completion */
  firstRunSec: 10 * 60,
  /** the longest a run ever gets — also the cap on how far ahead a run may end */
  maxRunSec: 3 * 60 * 60,
  /** completions at which a run reaches `maxRunSec`; the climb is linear before it */
  runFullAtCompletions: 50,
  /** each tier above 1 multiplies the interval by this much (deeper = rarer) */
  tierStep: 0.35,
  /** safety valve: never credit more than this much run in one settle (24 h) */
  maxCreditSec: 24 * 60 * 60,
  /** action XP a rig earns for every craft it completes on its own */
  xpPerCraft: 0.5,
} as const

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** Higher-tier actions run slower: tier 1 ×1, tier 5 ×2.4. */
export function tierFactor(tier: number): number {
  return 1 + IDLE.tierStep * Math.max(0, tier - 1)
}

/** Drills → seconds between items for that rig (tier 1: 10 s → 2 s, saturating). */
export function rigIntervalSec(completions: number, tier = 1): number {
  const c = Math.max(0, completions)
  const span = IDLE.firstIntervalSec - IDLE.floorIntervalSec
  return tierFactor(tier) * (IDLE.floorIntervalSec + span * 2 ** (-c / IDLE.intervalHalfLife))
}

/**
 * Drills → how long one completion's run lasts. A straight, equally-stepped
 * climb: the first completion lands on 10 minutes, every completion after adds
 * the same slice, and the 50th reaches the full 3 hours — then it holds.
 */
export function rigRunSec(completions: number): number {
  const steps = IDLE.runFullAtCompletions - 1
  const c = clamp(completions - 1, 0, steps)
  const span = IDLE.maxRunSec - IDLE.firstRunSec
  return IDLE.firstRunSec + (span * c) / steps
}

/** How far a rig is toward the run-length cap (0 at no drills, 1 at the cap). */
export function rigRunProgress(completions: number): number {
  return clamp(completions, 0, IDLE.runFullAtCompletions) / IDLE.runFullAtCompletions
}

/** Whether a rig's run has reached the cap — further drills buy no more time. */
export function rigMaxed(completions: number): boolean {
  return completions >= IDLE.runFullAtCompletions
}

/** One thing an action produces, and how many per craft. */
export interface RigProduce {
  item: string
  count: number
}

/**
 * Whole items from `done` crafts, folding a yield/double bonus into the rate.
 * The client extrapolates an in-flight run with this; the server's settle keeps
 * its own fractional carry on top.
 */
export function craftsToItems(
  done: number,
  produces: readonly RigProduce[],
  bonus: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of produces) {
    const n = Math.floor(done * p.count * bonus)
    if (n > 0) out[p.item] = n
  }
  return out
}

/** `1 / 7s` — one decimal below 10s, none at or above. */
export function formatInterval(sec: number): string {
  return `1 / ${sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)}s`
}

/** Human label for a rig's rate: `1 / 7s`. */
export function rigRateLabel(completions: number, tier = 1): string {
  return formatInterval(rigIntervalSec(completions, tier))
}
