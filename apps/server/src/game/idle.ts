/**
 * Idle rigs (docs/DESIGN.md §13.5.1).
 *
 * A completed drill does not hand you a stack of items; it **powers a machine**.
 * The machine (a "rig") is the action itself: while its run is alive the action
 * keeps producing its `produces` — and, for an artisan, consuming its `consumes` —
 * on its own. Every further completion makes the rig **faster** and extends the
 * run, so skill is rewarded twice: at the drill, and for the hours after it.
 *
 * There are **no timers and no per-second loop**. A rig is four recorded numbers —
 * `(completions, runEndsAt, settledAt, crafts + per-item remainder)` — and its
 * gain is one closed-form integral over a step-function rate that only ever
 * changes at a completion. `replayRig()` proves the claim the design rests on:
 * the completion log alone is enough to reconstruct the bank.
 */

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

/** The recorded state of one rig (mirrors the `action_progress` idle columns). */
export interface RigState {
  /** lifetime drill completions for this action — drives rate and length */
  completions: number
  /** ms; the run is alive while `now < runEndsAt` (`0` = still) */
  runEndsAt: number
  /** ms; accrual has been credited up to here */
  settledAt: number
  /** fractional crafts carried between settles (keeps `consumes` integral) */
  crafts: number
  /** fractional produced items carried per item id (no rounding loss) */
  remainder: Record<string, number>
  /** the choice a multi-recipe action's rig is running ('' = the first choice) */
  choice: string
}

/** What an action makes and needs, plus its expected-value bonuses. */
export interface RigRecipe {
  produces?: Cost[]
  consumes?: Cost[]
  /** action tier — deeper rigs run slower (see `tierFactor`) */
  tier?: number
  /** expected-value yield bonus (profession passive + talents), e.g. 0.15 */
  yieldBonus?: number
  /** expected-value bonus-product chance, folded into yield (see docs) */
  doubleBonus?: number
  /**
   * Chance each craft actually yields its `produces` (1 = always). Consumers still
   * pay their `consumes` on a miss — that is what makes prospecting a gamble (§13.5.3).
   * Folded into the rate as an expected-value multiplier on output only.
   */
  successChance?: number
}

export interface RigSettle {
  state: RigState
  /** items produced by the *run* this settle (never the drill's strike) */
  produced: Record<string, number>
  /** items consumed by the run this settle */
  consumed: Record<string, number>
  /** whole crafts completed on their own this settle (drives passive XP) */
  crafted: number
  /** seconds of live run credited (0 when the rig was still or starved) */
  creditedSec: number
  /** whether the run is still alive at `now` */
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

/** `bank` is a mutable view of the bank used to clamp an artisan's consumption. */
export type BankView = Map<string, number> | Record<string, number>

function bankGet(bank: BankView, item: string): number {
  return bank instanceof Map ? (bank.get(item) ?? 0) : (bank[item] ?? 0)
}

function bankAdd(bank: BankView, item: string, delta: number): void {
  if (bank instanceof Map) bank.set(item, Math.max(0, (bank.get(item) ?? 0) + delta))
  else bank[item] = Math.max(0, (bank[item] ?? 0) + delta)
}

/**
 * Credit a rig up to `now`. Pure: order in, order out. One call = one closed-form
 * computation, however much wall-clock time has passed.
 */
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

/** The state every settle starts from, plus whether the run is still alive. */
function rigStart(
  state: RigState,
  now: number,
): {
  next: RigState
  idle: RigSettle
  runEndsAt: number
} {
  // The invariant `extendRig` now maintains: a live run always ends within
  // `maxRunSec` of the current time. Reinforced here so a row written before the
  // cap existed (a run stacked to a day or more) is trimmed on its next settle.
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

/** An artisan: only craft from stock already in the bank, then spend it. */
function settleArtisan(a: SettleArgs): RigSettle {
  const { idle, next, recipe, bank, wanted, sec } = a
  const consumes = recipe.consumes ?? []
  // Clamped here, so no amount of offline time can manufacture a negative bank.
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

/** A gathering rig: nothing to consume, so every whole craft lands. */
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

/** How many crafts the bank's stock allows (unbounded when nothing is consumed). */
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

/** Apply `done` crafts' worth of `produces` with yield+double folded to a rate. */
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
    const raw = done * p.count * bonus + carried
    const n = Math.floor(raw)
    next.remainder[p.item] = raw - n
    if (n <= 0) continue
    bankAdd(bank, p.item, n)
    out.produced[p.item] = (out.produced[p.item] ?? 0) + n
  }
}

/**
 * How many rigs a player may keep **running at once** (docs/DESIGN.md §13.5.1).
 * Only a couple of machines can be live at a time, so powering a new action is a
 * choice — you keep the rigs you care about and let the rest fall still — instead
 * of an obligation to drill every action non-stop.
 */
export const MAX_LIVE_RIGS = 2

/**
 * Enforce the live-rig cap (§13.5.1). `keep` names rigs that must survive — the
 * action a drill just powered, so a drill always starts its own machine. When more
 * than `MAX_LIVE_RIGS` runs are alive, the ones with the **earliest** `runEndsAt`
 * are stopped first: the machines that were about to stop anyway, so the least run
 * time is thrown away. Pure: clears `runEndsAt` on the losers in place and returns
 * their action ids.
 */
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

/** How many rigs are alive at `now` (drives the "N / 2 running" readout). */
export function liveRigCount(rigs: Map<string, RigState>, now: number): number {
  let n = 0
  for (const r of rigs.values()) if (r.runEndsAt > now) n++
  return n
}

/**
 * Power the rig: bump the completion count and re-base the run. Call *after*
 * `settleRig(now)` so the old rate is paid up to the instant of the drill.
 *
 * The run length is a **function of the completion count** (`rigRunSec`), not a
 * sum of per-drill slices: a drill sets the run to end `rigRunSec(completions)`
 * from now, so 10 completions buy ~40 min and the 50th buys the full 3 h (the
 * ceiling). Stacking `+ rigRunSec` onto the previous end reached the 3 h cap
 * after ~10 rapid drills — far too fast — so the run is *re-based*, never
 * accumulated. The clamp is belt-and-braces: `rigRunSec` already tops out at
 * `maxRunSec`, and `settleRig` re-clamps on every read.
 */
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

/**
 * The determinism contract, executable: rebuild a rig from nothing but its
 * completion timestamps. `replayRig(times, …).produced` must equal the bank a live
 * session reached by settling as it went. Completions are `index + 1` in order.
 */
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

/** The running totals a replay accumulates across settles. */
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
