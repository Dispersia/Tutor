export const IDLE = {
  firstIntervalSec: 20,
  floorIntervalSec: 10,
  intervalHalfLife: 10,
  firstRunSec: 10 * 60,
  maxRunSec: 3 * 60 * 60,
  runFullAtCompletions: 25,
  tierStep: 0.35,
  maxCreditSec: 24 * 60 * 60,
  xpPerCraft: 0.9,
} as const

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export function tierFactor(tier: number): number {
  return 1 + IDLE.tierStep * Math.max(0, tier - 1)
}

export function rigIntervalSec(completions: number, tier = 1): number {
  const c = Math.max(0, completions)
  const span = IDLE.firstIntervalSec - IDLE.floorIntervalSec
  return tierFactor(tier) * (IDLE.floorIntervalSec + span * 2 ** (-c / IDLE.intervalHalfLife))
}

export function rigRunSec(completions: number): number {
  const steps = IDLE.runFullAtCompletions - 1
  const c = clamp(completions - 1, 0, steps)
  const span = IDLE.maxRunSec - IDLE.firstRunSec
  return IDLE.firstRunSec + (span * c) / steps
}

export function rigRunGainSec(completions: number): number {
  if (completions <= 1) return IDLE.firstRunSec
  return (IDLE.maxRunSec - IDLE.firstRunSec) / (IDLE.runFullAtCompletions - 1)
}

export function rigRunFill(secondsLeft: number): number {
  return clamp(secondsLeft, 0, IDLE.maxRunSec) / IDLE.maxRunSec
}

export function rigRunFull(secondsLeft: number): boolean {
  return secondsLeft >= IDLE.maxRunSec
}

export interface RigProduce {
  item: string
  count: number
}

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

export function formatInterval(sec: number): string {
  return `1 / ${sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)}s`
}

export function rigRateLabel(completions: number, tier = 1): string {
  return formatInterval(rigIntervalSec(completions, tier))
}
