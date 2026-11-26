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

export interface RigYield {
  item: string
  count: number
  multiplier: number
  remainder: number
}

export interface RigProduceBonus {
  successChance?: number
  yieldBonus?: number
  itemBonus?: Record<string, number>
}

export interface RigProduceResult {
  produced: Record<string, number>
  remainder: Record<string, number>
}

export function rigYields(
  produces: readonly RigProduce[],
  bonus: RigProduceBonus,
  remainder: Readonly<Record<string, number>>,
): RigYield[] {
  const rate = (bonus.successChance ?? 1) * (1 + (bonus.yieldBonus ?? 0))
  return produces.map((p) => ({
    item: p.item,
    count: p.count,
    multiplier: rate + (bonus.itemBonus?.[p.item] ?? 0),
    remainder: remainder[p.item] ?? 0,
  }))
}

export function idleProduces(crafts: number, yields: readonly RigYield[]): RigProduceResult {
  const done = Math.floor(crafts)
  const produced: Record<string, number> = {}
  const remainder: Record<string, number> = {}
  for (const y of yields) {
    const raw = done * y.count * y.multiplier + y.remainder
    const n = Math.floor(raw)
    remainder[y.item] = raw - n
    if (n > 0) produced[y.item] = n
  }
  return { produced, remainder }
}

export function formatInterval(sec: number): string {
  return `1 / ${sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)}s`
}

export function rigRateLabel(completions: number, tier = 1): string {
  return formatInterval(rigIntervalSec(completions, tier))
}
