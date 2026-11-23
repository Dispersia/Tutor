/** The idle-rig engine: settle, drill and stop (docs/DESIGN.md §13.5.1). */

import type { UserId } from '../ids'
import {
  addGatherLog,
  addItems,
  spendableCount,
  getRigState,
  listEquipment,
  listInventory,
  listRigStates,
  setRigState,
} from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import {
  IDLE,
  MAX_LIVE_RIGS,
  capLiveRigs,
  extendRig,
  liveRigCount,
  newRig,
  rigIntervalSec,
  rigMaxed,
  rigRunProgress,
  rigRunSec,
  settleRig,
  type RigState,
} from '../game/idle'
import {
  ACTION_BY_ID,
  ACTIONS,
  SKILL_BY_ID,
  actionConsumes,
  actionOdds,
  actionRoll,
  type ActionDef,
  type Cost,
} from '../game/skills'
import { actionProduces, actionSuccessChance } from './board'
import { consumeItems, grantItems } from './items'
import { awardActionXp, loadProgress, type ProgressCtx } from './progress'
import { atomic, inTransaction } from '../db/repo/helpers'

// --- idle rigs (docs/DESIGN.md §13.5.1) --------------------------------------

/**
 * The canonical settle order — **gathering → support → artisan → combat** — so a
 * miner's output is available to a smith in the same pass. The order is part of
 * the contract: same bank, same result, every time.
 */
const SETTLE_RANK: Record<string, number> = {
  gathering: 0,
  support: 1,
  artisan: 2,
  combat: 3,
}
const SETTLE_ORDER = [...ACTIONS].sort(
  (a, b) =>
    (SETTLE_RANK[SKILL_BY_ID.get(a.skillId)?.category ?? ''] ?? 9) -
    (SETTLE_RANK[SKILL_BY_ID.get(b.skillId)?.category ?? ''] ?? 9),
)

/** One action's rig as the UI needs it: rate, run clock and recipe. */
export interface IdleRigView {
  actionId: string
  /** lifetime drills that powered this rig */
  completions: number
  active: boolean
  /** ms epoch when the run ends (0 = still) */
  runEndsAt: number
  /** whole seconds left in the run */
  secondsLeft: number
  /** whole seconds a fresh completion's run lasts at this level */
  runSec: number
  /** the run-length cap (seconds): the longest a run can ever get */
  maxRunSec: number
  /** completions at which a run reaches `maxRunSec` — the end of the climb */
  runFullAtCompletions: number
  /** how far the rig is toward the cap: 0 → 1 (§13.5.1) */
  runProgress: number
  /** whether the run has reached the cap — the rig is as good as it gets */
  maxed: boolean
  /** seconds between items right now */
  intervalSec: number
  /** expected-value bonus already baked into a run (yield + double) */
  yieldBonus: number
  /** action XP each craft hands over while the run is live (base, before talents) */
  xpPerCraft: number
  produces: Cost[]
  consumes: Cost[]
  /** the recipe choice the rig is running ('' = the action's first choice) */
  choice: string
}

export interface SettleReport {
  /** everything the runs produced since the last settle */
  gained: Cost[]
  /** everything the runs consumed */
  spent: Cost[]
  /** action XP the runs earned on their own this settle (actionId → XP) */
  xp: Map<string, number>
  /** post-settle rig state per action (for building views without a second query) */
  rigs: Map<string, RigState>
  /** the action-level map and bonuses the settle loaded, reusable by the caller */
  progress: ProgressCtx
}

/** Fold a settled rig into the UI view. Pure. */
export function idleView(
  rig: RigState,
  action: ActionDef,
  now: number,
  yieldBonus: number,
): IdleRigView {
  return {
    actionId: action.id,
    completions: rig.completions,
    ...rigClock(rig, action, now),
    yieldBonus,
    xpPerCraft: IDLE.xpPerCraft,
    produces: actionProduces(action, rig.choice || undefined),
    consumes: actionConsumes(action, rig.choice || undefined),
    choice: rig.choice ?? '',
  }
}

/** The rig's clock readout: rate, run window and how close it is to the cap. */
function rigClock(rig: RigState, action: ActionDef, now: number) {
  return {
    active: rig.runEndsAt > now,
    runEndsAt: rig.runEndsAt,
    secondsLeft: Math.max(0, Math.round((rig.runEndsAt - now) / 1000)),
    runSec: Math.round(rigRunSec(rig.completions)),
    maxRunSec: IDLE.maxRunSec,
    runFullAtCompletions: IDLE.runFullAtCompletions,
    runProgress: rigRunProgress(rig.completions),
    maxed: rigMaxed(rig.completions),
    intervalSec: rigIntervalSec(rig.completions, action.tier),
  }
}

/**
 * Credit **every** running rig up to `now`, in one pass, against one mutable bank.
 * This is the whole idle engine: O(actions) rows of pure arithmetic, one
 * transaction, no timers. Hundreds of offline hours cost the same as one second.
 */
export function settleRigs(db: Db, bus: EventBus, userId: UserId, now = Date.now()): SettleReport {
  // Every write below is one unit: a crash mid-settle must not leave a half-paid
  // bank or a half-advanced rig.
  return inTransaction(db, (tx) => settleRigsTx(tx, bus, userId, now))
}

function settleRigsTx(db: Db, bus: EventBus, userId: UserId, now: number): SettleReport {
  const bank = inventoryMap(db, userId)
  const before = new Map(bank)
  const rigs = listRigStates(db, userId)
  const progress = loadProgress(db, userId)
  const totals = settleEach({ db, userId, now, progress, bank, rigs })
  capAndPersist(db, userId, rigs, now)
  writeBank(db, userId, bank, before)
  const gained = toCosts(totals.produced)
  const spent = toCosts(totals.consumed)
  for (const [actionId, amount] of totals.xp) {
    awardActionXp(db, bus, userId, { actionId, amount, ctx: progress })
  }
  if (gained.length || spent.length) bus.emit('idle.settled', { userId, gained, spent })
  return { gained, spent, xp: totals.xp, rigs, progress }
}

function inventoryMap(db: Db, userId: UserId): Map<string, number> {
  const bank = new Map<string, number>()
  // What a rig may spend: worn gear is in the bank's count but is not material.
  const worn = new Map<string, number>()
  for (const e of listEquipment(db, userId)) worn.set(e.itemId, (worn.get(e.itemId) ?? 0) + 1)
  for (const r of listInventory(db, userId)) bank.set(r.itemId, r.count - (worn.get(r.itemId) ?? 0))
  return bank
}

/** Everything one settle pass reads, plus the mutable bank and rig map. */
interface SettleCtx {
  db: Db
  userId: UserId
  now: number
  progress: ProgressCtx
  bank: Map<string, number>
  rigs: Map<string, RigState>
}

interface SettleTotals {
  produced: Record<string, number>
  consumed: Record<string, number>
  xp: Map<string, number>
}

function settleEach(ctx: SettleCtx): SettleTotals {
  const totals: SettleTotals = { produced: {}, consumed: {}, xp: new Map() }
  for (const action of SETTLE_ORDER) settleOne(ctx, action, totals)
  return totals
}

/** Credits one action's rig, folding what it made, ate and earned into totals. */
function settleOne(ctx: SettleCtx, action: ActionDef, totals: SettleTotals): void {
  const rig = ctx.rigs.get(action.id)
  if (!rig) return
  const choiceId = rig.choice || undefined
  const res = settleRig(rig, recipeOf(action, choiceId, ctx.progress), ctx.bank, ctx.now)
  const xp = wholeXp(res.state, res.crafted)
  // A rig that was already still (most rows: XP-only actions and finished runs)
  // has nothing to pay, so it is not rewritten on every board load.
  const ranInWindow = rig.runEndsAt > rig.settledAt
  if (ranInWindow || res.creditedSec > 0 || res.state.runEndsAt !== rig.runEndsAt) {
    setRigState(ctx.db, ctx.userId, action.id, res.state)
    ctx.rigs.set(action.id, res.state)
  }
  for (const [item, n] of Object.entries(res.produced)) {
    totals.produced[item] = (totals.produced[item] ?? 0) + n
  }
  for (const [item, n] of Object.entries(res.consumed)) {
    totals.consumed[item] = (totals.consumed[item] ?? 0) + n
  }
  if (xp > 0) totals.xp.set(action.id, xp)
}

/** Where a rig keeps the fraction of an XP point it has earned but not been paid. */
const XP_CARRY = '$xp'

/**
 * The whole XP these crafts pay, carrying the fraction on the rig. A craft is
 * worth half a point, so rounding per settle paid a player who settles after
 * every craft twice what one long offline settle paid for the same work.
 */
function wholeXp(state: RigState, crafted: number): number {
  if (crafted <= 0) return 0
  const earned = crafted * IDLE.xpPerCraft + (state.remainder[XP_CARRY] ?? 0)
  const whole = Math.floor(earned)
  state.remainder[XP_CARRY] = earned - whole
  return whole
}

/** The recipe a settled rig ran, with its level-scaled odds and yield bonus. */
function recipeOf(action: ActionDef, choiceId: string | undefined, progress: ProgressCtx) {
  const { bonuses, levels } = progress
  return {
    produces: actionProduces(action, choiceId),
    consumes: actionConsumes(action, choiceId),
    tier: action.tier,
    // an artisan's expected bonus product is folded into the run's rate
    yieldBonus: bonuses.yield(action.id) + bonuses.double(action.id),
    // the coins passive pays on coins only, not on the gems stolen with them
    itemBonus: { coins: bonuses.coins(action.id) },
    // a prospect consumes its ore but only pays out at its odds (§13.5.3.1)
    successChance: actionOdds(action, choiceId, levels.get(action.id) ?? 1),
  }
}

/** The live-rig cap (§13.5.1): never more than `MAX_LIVE_RIGS` runs at once. */
function capAndPersist(db: Db, userId: UserId, rigs: Map<string, RigState>, now: number): void {
  for (const id of capLiveRigs(rigs, now)) setRigState(db, userId, id, rigs.get(id)!)
}

/**
 * Writes the settled bank back as deltas. Equipment rides along: `listInventory`
 * counts a member's pieces and `addItems` rolls each one a rig forged (and
 * removes each one a rig consumed), so the bank map never needs to know.
 */
function writeBank(
  db: Db,
  userId: UserId,
  bank: Map<string, number>,
  before: Map<string, number>,
): void {
  for (const [item, count] of bank) {
    const delta = count - (before.get(item) ?? 0)
    if (delta !== 0) addItems(db, userId, item, delta, Math.random)
  }
}

export interface DrillRigResult {
  gained: Cost[]
  consumed: Cost[]
  idle: IdleRigView | null
  xp: number
  /** rigs alive right now, after the cap (§13.5.1) */
  rigsRunning: number
  /** the live-rig cap — how many rigs may run at once */
  maxLiveRigs: number
  /** the rig this drill pushed over the cap and stopped, if any (§13.5.1) */
  stoppedRig: { actionId: string; name: string; skillId: string } | null
}

/**
 * The drill's real reward: pay every running rig up to now, land the **strike**
 * (the old flat yield, so the loop keeps its heartbeat), then power this action's
 * rig — every run is faster and longer than the last.
 */
function completeActionTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  req: { actionId: string; now?: number; rand?: () => number; choiceId?: string },
): DrillRigResult {
  const now = req.now ?? Date.now()
  const report = settleRigs(db, bus, userId, now)
  const settledXp = xpTotal(report)
  const action = ACTION_BY_ID.get(req.actionId)
  if (!action) return noRigResult(report, settledXp, now)
  return drillAction({ db, bus, userId, action, now, report, settledXp, opts: req })
}

/** {@link completeActionTx}, all-or-nothing. */
export const completeAction = atomic(completeActionTx)

function xpTotal(report: SettleReport): number {
  return [...report.xp.values()].reduce((n, v) => n + v, 0)
}

interface DrillReq {
  db: Db
  bus: EventBus
  userId: UserId
  action: ActionDef
  now: number
  report: SettleReport
  settledXp: number
  opts: { rand?: () => number; choiceId?: string }
}

/**
 * The drill's real reward: pay every running rig up to now, land the **strike**
 * (the old flat yield, so the loop keeps its heartbeat), then power this action's
 * rig — every run is faster and longer than the last.
 */
function drillAction(req: DrillReq): DrillRigResult {
  const rand = req.opts.rand ?? Math.random
  // Which recipe the drill ran: the one the UI passed, else whatever the rig last
  // ran, else the action's first choice.
  const current = getRigState(req.db, req.userId, req.action.id) ?? newRig()
  const choiceId = req.opts.choiceId ?? (current.choice || undefined)
  const strike = drillStrike(req.db, req.bus, req.userId, {
    action: req.action,
    choiceId,
    rand,
    levels: req.report.progress.levels,
  })
  const powered = powerRig(req, current, choiceId)
  const stoppedRig = capAfterDrill(req.db, req.userId, req.report.rigs, req.action.id, req.now)
  return drillResult(req, strike, powered, stoppedRig)
}

function noRigResult(report: SettleReport, settledXp: number, now: number): DrillRigResult {
  return {
    gained: report.gained,
    consumed: report.spent,
    idle: null,
    xp: settledXp,
    rigsRunning: liveRigCount(report.rigs, now),
    maxLiveRigs: MAX_LIVE_RIGS,
    stoppedRig: null,
  }
}

const NO_STRIKE: DrillStrike = { gained: [], spent: [] }

interface StrikeReq {
  action: ActionDef
  choiceId?: string
  rand: () => number
  levels: Map<string, number>
}

/**
 * A prospect consumes its input but only *pays out* at its odds (§13.5.3.1), and
 * a `table` action rolls a single gem. The strike still powers the rig either way.
 */
function drillStrike(db: Db, bus: EventBus, userId: UserId, req: StrikeReq): DrillStrike {
  const spent = actionConsumes(req.action, req.choiceId)
  // The route's gate ran before the settle; this action's own rig may have used
  // the stock since. No stock, no strike: the drill still powers the rig.
  if (spent.some((c) => spendableCount(db, userId, c.item) < c.count)) return NO_STRIKE
  const chance = actionSuccessChance(db, userId, req.action, req.choiceId, req.levels)
  const hit = chance >= 1 || req.rand() < chance
  const gained = hit
    ? grantItems(db, bus, userId, {
        actionId: req.action.id,
        costs: actionRoll(req.action, req.choiceId, req.rand),
      })
    : []
  if (spent.length) consumeItems(db, bus, userId, spent)
  return { gained, spent }
}

/**
 * The drill always powers its own machine. `report.rigs` already carries the
 * post-settle (and post-cap) states, so no second query is needed.
 */
function powerRig(req: DrillReq, current: RigState, choiceId?: string): RigState {
  const powered = extendRig({ ...current, settledAt: req.now, choice: choiceId ?? '' }, req.now)
  setRigState(req.db, req.userId, req.action.id, powered)
  addGatherLog(req.db, req.userId, req.action.id, powered.completions)
  req.report.rigs.set(req.action.id, powered)
  return powered
}

/** If the drill made a third run live, the cap stops the one closest to done. */
function capAfterDrill(
  db: Db,
  userId: UserId,
  rigs: Map<string, RigState>,
  actionId: string,
  now: number,
): DrillRigResult['stoppedRig'] {
  const stopped = capLiveRigs(rigs, now, [actionId])
  for (const id of stopped) setRigState(db, userId, id, rigs.get(id)!)
  const action = stopped[0] ? ACTION_BY_ID.get(stopped[0]) : undefined
  return action ? { actionId: action.id, name: action.name, skillId: action.skillId } : null
}

interface DrillStrike {
  gained: Cost[]
  spent: Cost[]
}

function drillResult(
  req: DrillReq,
  strike: DrillStrike,
  powered: RigState,
  stoppedRig: DrillRigResult['stoppedRig'],
): DrillRigResult {
  const bonus = req.report.progress.bonuses
  const yieldBonus = bonus.yield(req.action.id) + bonus.double(req.action.id)
  return {
    gained: mergeCosts(req.report.gained, strike.gained),
    consumed: mergeCosts(req.report.spent, strike.spent),
    idle: idleView(powered, req.action, req.now, yieldBonus),
    xp: req.settledXp,
    rigsRunning: liveRigCount(req.report.rigs, req.now),
    maxLiveRigs: MAX_LIVE_RIGS,
    stoppedRig,
  }
}

/**
 * Stop a running rig on purpose (§13.5.1): settle its run up to now (so no work is
 * lost), then let it fall still so its slot frees for another machine. The player's
 * escape hatch from the live-rig cap — the UI confirms before calling this.
 * Returns false when the action has no live run.
 */
function stopRigTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  actionId: string,
  now = Date.now(),
): boolean {
  const report = settleRigs(db, bus, userId, now)
  const rig = report.rigs.get(actionId)
  if (!rig || rig.runEndsAt <= now) return false
  setRigState(db, userId, actionId, { ...rig, runEndsAt: 0, settledAt: now })
  return true
}

/** {@link stopRigTx}, all-or-nothing. */
export const stopRig = atomic(stopRigTx)

/** Remember which recipe a choose-input action's rig runs (§13.5.3.1). */
function setRigChoiceTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  pick: { actionId: string; choiceId: string },
): boolean {
  const { actionId, choiceId } = pick
  const action = ACTION_BY_ID.get(actionId)
  if (!action?.choices?.length) return false
  if (!action.choices.some((c) => c.id === choiceId)) return false
  // Pay the run so far at the recipe it actually ran; only time from now on is
  // priced at the new one.
  const current = settleRigs(db, bus, userId).rigs.get(actionId) ?? newRig()
  setRigState(db, userId, actionId, { ...current, choice: choiceId })
  return true
}

/** {@link setRigChoiceTx}, all-or-nothing. */
export const setRigChoice = atomic(setRigChoiceTx)

function toCosts(map: Record<string, number>): Cost[] {
  return Object.entries(map)
    .filter(([, n]) => n > 0)
    .map(([item, count]) => ({ item, count }))
}

function mergeCosts(...lists: Cost[][]): Cost[] {
  const out = new Map<string, number>()
  for (const list of lists) for (const c of list) out.set(c.item, (out.get(c.item) ?? 0) + c.count)
  return [...out].map(([item, count]) => ({ item, count })).filter((c) => c.count > 0)
}
