import {
  IDLE,
  rigIntervalSec,
  rigMaxed,
  rigRateLabel,
  rigRunProgress,
  rigRunSec,
  tierFactor,
} from '@tutor/core'
import type { Cost } from './skills'

export { IDLE, rigIntervalSec, rigMaxed, rigRateLabel, rigRunProgress, rigRunSec, tierFactor }

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export interface RigState {
  completions: number
  runEndsAt: number
  settledAt: number
  crafts: number
  remainder: Record<string, number>
  choice: string
}

export interface RigRecipe {
  produces?: Cost[]
  consumes?: Cost[]
  tier?: number
  yieldBonus?: number
  doubleBonus?: number
  itemBonus?: Record<string, number>
  successChance?: number
}

export interface RigSettle {
  state: RigState
  produced: Record<string, number>
  consumed: Record<string, number>
  crafted: number
  creditedSec: number
  running: boolean
}

const EMPTY_STATE: RigState = {
  completions: 0,
  runEndsAt: 0,
  settledAt: 0,
  crafts: 0,
  remainder: {},
  choice: '',
}

export function newRig(): RigState {
  return { ...EMPTY_STATE, remainder: {} }
}

export type BankView = Map<string, number> | Record<string, number>

function bankGet(bank: BankView, item: string): number {
  return bank instanceof Map ? (bank.get(item) ?? 0) : (bank[item] ?? 0)
}

function bankAdd(bank: BankView, item: string, delta: number): void {
  if (bank instanceof Map) bank.set(item, Math.max(0, (bank.get(item) ?? 0) + delta))
  else bank[item] = Math.max(0, (bank[item] ?? 0) + delta)
}

export function settleRig(
  state: RigState,
  recipe: RigRecipe,
  bank: BankView,
  now: number,
): RigSettle {
  const from = Math.max(0, state.settledAt)
  const { next, idle, runEndsAt } = rigStart(state, now)
  if (runEndsAt <= 0 || now <= from) return idle
  const end = Math.min(now, runEndsAt)
  if (end <= from) return idle
  const sec = clamp((end - from) / 1000, 0, IDLE.maxCreditSec)
  const wanted = state.crafts + sec / rigIntervalSec(state.completions, recipe.tier ?? 1)
  const args: SettleArgs = { idle, next, recipe, bank, wanted, sec }
  return (recipe.consumes?.length ?? 0) > 0 ? settleArtisan(args) : settlePassive(args)
}

function rigStart(
  state: RigState,
  now: number,
): {
  next: RigState
  idle: RigSettle
  runEndsAt: number
} {
  const runEndsAt = state.runEndsAt > 0 ? Math.min(state.runEndsAt, now + IDLE.maxRunSec * 1000) : 0
  const next: RigState = { ...state, runEndsAt, settledAt: now, remainder: { ...state.remainder } }
  return { next, runEndsAt, idle: emptySettle(next, runEndsAt > now) }
}

function emptySettle(state: RigState, running: boolean): RigSettle {
  return { state, produced: {}, consumed: {}, crafted: 0, creditedSec: 0, running }
}

interface SettleArgs {
  idle: RigSettle
  next: RigState
  recipe: RigRecipe
  bank: BankView
  wanted: number
  sec: number
}

function settleArtisan(a: SettleArgs): RigSettle {
  const { idle, next, recipe, bank, wanted, sec } = a
  const consumes = recipe.consumes ?? []
  const allowed = stockLimit(bank, consumes)
  const done = Math.max(0, Math.min(Math.floor(wanted), allowed))
  next.crafts = Math.min(wanted - done, 0.999)
  if (done <= 0) return idle
  spendStock(idle, bank, consumes, done)
  idle.creditedSec = sec
  idle.crafted = done
  emitProduced(idle, recipe, done, bank, next)
  return idle
}

function settlePassive(a: SettleArgs): RigSettle {
  const { idle, next, recipe, bank, wanted, sec } = a
  const done = Math.floor(wanted)
  next.crafts = wanted - done
  if (done <= 0) return idle
  idle.creditedSec = sec
  idle.crafted = done
  emitProduced(idle, recipe, done, bank, next)
  return idle
}

function stockLimit(bank: BankView, consumes: Cost[]): number {
  let allowed = Number.POSITIVE_INFINITY
  for (const c of consumes) {
    if (c.count > 0) allowed = Math.min(allowed, Math.floor(bankGet(bank, c.item) / c.count))
  }
  return allowed
}

function spendStock(idle: RigSettle, bank: BankView, consumes: Cost[], done: number): void {
  for (const c of consumes) {
    const n = done * c.count
    bankAdd(bank, c.item, -n)
    idle.consumed[c.item] = (idle.consumed[c.item] ?? 0) + n
  }
}

function emitProduced(
  out: RigSettle,
  recipe: RigRecipe,
  done: number,
  bank: BankView,
  next: RigState,
): void {
  const bonus =
    (recipe.successChance ?? 1) * (1 + (recipe.yieldBonus ?? 0) + (recipe.doubleBonus ?? 0))
  for (const p of recipe.produces ?? []) {
    const carried = next.remainder[p.item] ?? 0
    const raw = done * p.count * (bonus + (recipe.itemBonus?.[p.item] ?? 0)) + carried
    const n = Math.floor(raw)
    next.remainder[p.item] = raw - n
    if (n <= 0) continue
    bankAdd(bank, p.item, n)
    out.produced[p.item] = (out.produced[p.item] ?? 0) + n
  }
}

export const MAX_LIVE_RIGS = 2

export function capLiveRigs(
  rigs: Map<string, RigState>,
  now: number,
  keep: readonly string[] = [],
): string[] {
  const live = [...rigs.entries()].filter(([, r]) => r.runEndsAt > now)
  if (live.length <= MAX_LIVE_RIGS) return []
  const kept = new Set(keep)
  const keepCount = live.reduce((n, [id]) => n + (kept.has(id) ? 1 : 0), 0)
  const slots = Math.max(0, MAX_LIVE_RIGS - keepCount)
  const pool = live.filter(([id]) => !kept.has(id)).sort((a, b) => a[1].runEndsAt - b[1].runEndsAt)
  const losers = pool.slice(0, pool.length - slots)
  for (const [id, r] of losers) rigs.set(id, { ...r, runEndsAt: 0 })
  return losers.map(([id]) => id)
}

export function liveRigCount(rigs: Map<string, RigState>, now: number): number {
  let n = 0
  for (const r of rigs.values()) if (r.runEndsAt > now) n++
  return n
}

export function extendRig(state: RigState, now: number): RigState {
  const completions = state.completions + 1
  const runEndsAt = now + Math.round(rigRunSec(completions) * 1000)
  return {
    ...state,
    completions,
    runEndsAt: Math.min(runEndsAt, now + IDLE.maxRunSec * 1000),
    settledAt: now,
  }
}

export function replayRig(
  completionTimes: readonly number[],
  recipe: RigRecipe,
  now: number,
  bank: BankView = new Map(),
): RigSettle {
  let state = newRig()
  const totals: Totals = { produced: {}, consumed: {}, crafted: 0 }
  for (const at of [...completionTimes].sort((a, b) => a - b)) {
    const settled = settleRig(state, recipe, bank, at)
    fold(settled, totals)
    state = extendRig(settled.state, at)
  }
  const last = settleRig(state, recipe, bank, now)
  fold(last, totals)
  return { ...last, ...totals }
}

interface Totals {
  produced: Record<string, number>
  consumed: Record<string, number>
  crafted: number
}

function fold(settled: RigSettle, totals: Totals): void {
  merge(totals.produced, settled.produced)
  merge(totals.consumed, settled.consumed)
  totals.crafted += settled.crafted
}

function merge(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v
}
