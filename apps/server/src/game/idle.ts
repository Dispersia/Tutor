import {
  IDLE,
  idleProduces,
  rigIntervalSec,
  rigRunFill,
  rigRunFull,
  rigRunGainSec,
  rigRunSec,
  rigYields,
} from '@tutor/core'
import { ACTIONS, SKILL_BY_ID, type ActionDef, type Cost } from './skills'

export { IDLE, rigIntervalSec, rigRunFill, rigRunFull, rigRunGainSec, rigRunSec }

const SETTLE_RANK: Record<string, number> = {
  gathering: 0,
  support: 1,
  artisan: 2,
  combat: 3,
}

export const SETTLE_ORDER: readonly ActionDef[] = [...ACTIONS].sort(
  (a, b) =>
    (SETTLE_RANK[SKILL_BY_ID.get(a.skillId)?.category ?? ''] ?? 9) -
    (SETTLE_RANK[SKILL_BY_ID.get(b.skillId)?.category ?? ''] ?? 9),
)

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export interface RigState {
  completions: number
  runEndsAt: number
  runStartedAt: number
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

function hasRecipe(recipe: RigRecipe): boolean {
  return (recipe.consumes?.length ?? 0) > 0 || (recipe.produces?.length ?? 0) > 0
}

const EMPTY_STATE: RigState = {
  completions: 0,
  runEndsAt: 0,
  runStartedAt: 0,
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

export interface RigWindow {
  next: RigState
  idle: RigSettle
  sec: number
  wanted: number
  active: boolean
}

export function rigAdvance(state: RigState, tier: number, now: number): RigWindow {
  const from = Math.max(0, state.settledAt)
  const { next, idle, runEndsAt } = rigStart(state, now)
  const end = Math.min(now, runEndsAt)
  if (runEndsAt <= 0 || now <= from || end <= from) {
    return { next, idle, sec: 0, wanted: 0, active: false }
  }
  const sec = clamp((end - from) / 1000, 0, IDLE.maxCreditSec)
  const wanted = state.crafts + sec / rigIntervalSec(state.completions, tier || 1)
  return { next, idle, sec, wanted, active: true }
}

export function settleRig(
  state: RigState,
  recipe: RigRecipe,
  bank: BankView,
  now: number,
): RigSettle {
  const { next, idle, sec, wanted, active } = rigAdvance(state, recipe.tier ?? 1, now)
  if (!hasRecipe(recipe) || !active) return idle
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
  const yields = rigYields(recipe.produces ?? [], recipe, next.remainder)
  const { produced, remainder } = idleProduces(done, yields)
  for (const [item, n] of Object.entries(produced)) {
    bankAdd(bank, item, n)
    out.produced[item] = (out.produced[item] ?? 0) + n
  }
  Object.assign(next.remainder, remainder)
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
  const base = Math.max(state.runEndsAt, now)
  const live = state.runEndsAt > now && state.runStartedAt > 0
  const runStartedAt = live ? state.runStartedAt : now
  const gained = Math.round(rigRunGainSec(completions) * 1000)
  return {
    ...state,
    completions,
    runStartedAt,
    runEndsAt: Math.min(base + gained, now + IDLE.maxRunSec * 1000),
    settledAt: now,
  }
}
