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

import type { Cost } from './skills'

/**
 * The curve (docs/DESIGN.md §13.5.1). All values are seconds except `strike`.
 * Tune here — nothing else in the engine holds a magic number.
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
  /** the longest a run ever gets — also the hard cap on how far ahead a run may end */
  maxRunSec: 6 * 60 * 60,
  /** completions at which a run reaches `maxRunSec`; the climb is linear before it */
  runFullAtCompletions: 50,
  /** each tier above 1 multiplies the interval by this much (deeper = rarer) */
  tierStep: 0.35,
  /** safety valve: never credit more than this much run in one settle (24 h) */
  maxCreditSec: 24 * 60 * 60,
  /**
   * Action XP the rig earns for **every craft it completes on its own** (before
   * talent bonuses). A drill hands over `action.xp`; a live run hands this per
   * item, so a machine left running levels the profession the same way drilling
   * does — just by the clock. Halved from `1` so a full 6 h maxed run is ~5.4k
   * XP (about a tenth of a cap) instead of ~10.8k (a fifth): the machines still
   * do most of the leveling, but capping an action now takes ~11 runs, not ~5.
   * See docs/DESIGN.md §13.5.1.
   */
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
 * Drills → how long one completion's run lasts. A **straight, equally-stepped
 * climb**: the first completion lands on 10 minutes, every completion after adds
 * the same slice, and the 50th reaches the full 6 hours — then it holds. `c − 1`
 * so the first completion is `firstRunSec`, matching "do just one and it gathers
 * for 10 minutes".
 */
export function rigRunSec(completions: number): number {
  const steps = IDLE.runFullAtCompletions - 1
  const c = clamp(completions - 1, 0, steps)
  const span = IDLE.maxRunSec - IDLE.firstRunSec
  return IDLE.firstRunSec + (span * c) / steps
}

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
  // The invariant `extendRig` now maintains: a live run always ends within
  // `maxRunSec` of the current time. Reinforced here so a row written before the
  // cap existed (a run stacked to a day or more) is trimmed on its next settle.
  const runEndsAt = state.runEndsAt > 0 ? Math.min(state.runEndsAt, now + IDLE.maxRunSec * 1000) : 0
  const running = runEndsAt > now
  const next: RigState = { ...state, runEndsAt, settledAt: now, remainder: { ...state.remainder } }
  const idle: RigSettle = {
    state: next,
    produced: {},
    consumed: {},
    crafted: 0,
    creditedSec: 0,
    running,
  }
  if (runEndsAt <= 0 || now <= from) return idle

  const end = Math.min(now, runEndsAt)
  if (end <= from) return idle
  const sec = clamp((end - from) / 1000, 0, IDLE.maxCreditSec)

  const rate = 1 / rigIntervalSec(state.completions, recipe.tier ?? 1)
  const wanted = state.crafts + rate * sec

  const consumes = recipe.consumes ?? []
  let crafts: number
  if (consumes.length > 0) {
    // An artisan can only craft from stock already in the bank (clamped here, so
    // no amount of offline time can manufacture a negative bank).
    let allowed = Number.POSITIVE_INFINITY
    for (const c of consumes) {
      const have = bankGet(bank, c.item)
      if (c.count > 0) allowed = Math.min(allowed, Math.floor(have / c.count))
    }
    const done = Math.max(0, Math.min(Math.floor(wanted), allowed))
    crafts = Math.min(wanted - done, 0.999)
    if (done > 0) {
      for (const c of consumes) {
        const n = done * c.count
        bankAdd(bank, c.item, -n)
        idle.consumed[c.item] = (idle.consumed[c.item] ?? 0) + n
      }
    }
    if (done <= 0) {
      return { ...idle, state: { ...next, crafts } }
    }
    idle.creditedSec = sec
    idle.crafted = done
    emitProduced(idle, recipe, done, bank, next)
    next.crafts = crafts
    return idle
  }

  const done = Math.floor(wanted)
  crafts = wanted - done
  next.crafts = crafts
  if (done <= 0) return idle
  idle.creditedSec = sec
  idle.crafted = done
  emitProduced(idle, recipe, done, bank, next)
  return idle
}

/** Apply `done` crafts' worth of `produces` with yield+double folded to a rate. */
function emitProduced(
  out: RigSettle,
  recipe: RigRecipe,
  done: number,
  bank: BankView,
  next: RigState,
): void {
  const bonus = 1 + (recipe.yieldBonus ?? 0) + (recipe.doubleBonus ?? 0)
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
 * Power the rig: bump the completion count and re-base the run. Call *after*
 * `settleRig(now)` so the old rate is paid up to the instant of the drill.
 *
 * The run length is a **function of the completion count** (`rigRunSec`), not a
 * sum of per-drill slices: a drill sets the run to end `rigRunSec(completions)`
 * from now, so 10 completions buy ~1.2 h and the 50th buys the full 6 h (the
 * ceiling). Stacking `+ rigRunSec` onto the previous end reached the 6 h cap
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
  const produced: Record<string, number> = {}
  const consumed: Record<string, number> = {}
  let crafted = 0
  for (const at of [...completionTimes].sort((a, b) => a - b)) {
    const settled = settleRig(state, recipe, bank, at)
    merge(produced, settled.produced)
    merge(consumed, settled.consumed)
    crafted += settled.crafted
    state = extendRig(settled.state, at)
  }
  const last = settleRig(state, recipe, bank, now)
  merge(produced, last.produced)
  merge(consumed, last.consumed)
  crafted += last.crafted
  return { ...last, produced, consumed, crafted }
}

function merge(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v
}

/** Human label for a rig's rate: `1 / 7s` (the web also formats its own). */
export function rigRateLabel(completions: number, tier = 1): string {
  const sec = rigIntervalSec(completions, tier)
  return `1 / ${sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)}s`
}
