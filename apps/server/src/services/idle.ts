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
  SETTLE_ORDER,
  capLiveRigs,
  extendRig,
  liveRigCount,
  newRig,
  rigIntervalSec,
  rigRunFill,
  rigRunFull,
  rigRunSec,
  settleRig,
  type RigRecipe,
  type RigSettle,
  type RigState,
} from '../game/idle'
import { rigYields, type RigYield } from '@tutor/core'
import {
  ACTION_BY_ID,
  actionConsumes,
  actionExpected,
  actionOdds,
  actionRoll,
  type ActionDef,
  type Cost,
} from '../game/skills'
import { distillBurn, distillPerCraft, getDistillConfig } from './distill'
import { consumeItems, grantItems } from './items'
import { awardAllXp, loadProgress, type ProgressCtx } from './progress'
import { atomic, inTransaction } from '../db/repo/helpers'

export interface IdleRigView {
  actionId: string
  completions: number
  active: boolean
  runEndsAt: number
  runStartedAt: number
  secondsLeft: number
  runSec: number
  maxRunSec: number
  runFullAtCompletions: number
  runProgress: number
  maxed: boolean
  intervalSec: number
  crafts: number
  xpPerCraft: number
  produces: RigYield[]
  consumes: Cost[]
  choice: string
}

export interface SettleReport {
  gained: Cost[]
  spent: Cost[]
  xp: Map<string, number>
  awards: Map<string, number>
  rigs: Map<string, RigState>
  progress: ProgressCtx
}

export function idleView(
  rig: RigState,
  action: ActionDef,
  now: number,
  recipe: RigRecipe,
  xpPerCraft: number = IDLE.xpPerCraft,
): IdleRigView {
  return {
    actionId: action.id,
    completions: rig.completions,
    ...rigClock(rig, action, now),
    crafts: rig.crafts,
    xpPerCraft,
    produces: rigYields(recipe.produces ?? [], recipe, rig.remainder),
    consumes: recipe.consumes ?? [],
    choice: rig.choice ?? '',
  }
}

function rigClock(rig: RigState, action: ActionDef, now: number) {
  const secondsLeft = Math.max(0, Math.round((rig.runEndsAt - now) / 1000))
  return {
    active: rig.runEndsAt > now,
    runEndsAt: rig.runEndsAt,
    runStartedAt: rig.runStartedAt,
    secondsLeft,
    runSec: Math.round(rigRunSec(rig.completions)),
    maxRunSec: IDLE.maxRunSec,
    runFullAtCompletions: IDLE.runFullAtCompletions,
    runProgress: rigRunFill(secondsLeft),
    maxed: rigRunFull(secondsLeft),
    intervalSec: rigIntervalSec(rig.completions, action.tier),
  }
}

export function settleRigs(
  db: Db,
  bus: EventBus,
  userId: UserId,
  now = Date.now(),
  progress?: ProgressCtx,
): SettleReport {
  return inTransaction(db, (tx) => settleRigsTx(tx, bus, userId, now, progress))
}

function settleRigsTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
  now: number,
  pre?: ProgressCtx,
): SettleReport {
  const bank = inventoryMap(db, userId)
  const before = new Map(bank)
  const rigs = listRigStates(db, userId)
  const progress = pre ?? loadProgress(db, userId)
  const totals = settleEach({ db, userId, now, progress, bank, rigs })
  capAndPersist(db, userId, rigs, now)
  writeBank(db, userId, bank, before)
  const gained = toCosts(totals.produced)
  const spent = toCosts(totals.consumed)
  const awards = awardAllXp(db, bus, userId, totals.xp, progress)
  if (gained.length || spent.length) bus.emit('idle.settled', { userId, gained, spent })
  return { gained, spent, xp: totals.xp, awards, rigs, progress }
}

function inventoryMap(db: Db, userId: UserId): Map<string, number> {
  const bank = new Map<string, number>()
  const worn = new Map<string, number>()
  for (const e of listEquipment(db, userId)) worn.set(e.itemId, (worn.get(e.itemId) ?? 0) + 1)
  for (const r of listInventory(db, userId)) bank.set(r.itemId, r.count - (worn.get(r.itemId) ?? 0))
  return bank
}

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

function settleOne(ctx: SettleCtx, action: ActionDef, totals: SettleTotals): void {
  const rig = ctx.rigs.get(action.id)
  if (!rig) return
  const outcome =
    action.id === 'distill' ? distillOutcome(ctx, rig, action) : recipeOutcome(ctx, rig, action)
  persistRig(ctx, action.id, rig, outcome.settle)
  mergeInto(totals.produced, outcome.settle.produced)
  mergeInto(totals.consumed, outcome.settle.consumed)
  if (outcome.xp > 0) totals.xp.set(action.id, outcome.xp)
}

interface Outcome {
  settle: RigSettle
  xp: number
}

function recipeOutcome(ctx: SettleCtx, rig: RigState, action: ActionDef): Outcome {
  const recipe = rigRecipe(action, rig.choice || undefined, ctx.progress)
  const settle = settleRig(rig, recipe, ctx.bank, ctx.now)
  return { settle, xp: wholeXp(settle.state, settle.crafted) }
}

function distillOutcome(ctx: SettleCtx, rig: RigState, action: ActionDef): Outcome {
  const config = getDistillConfig(ctx.db, ctx.userId)
  return distillBurn(rig, action.tier, ctx.bank, config, ctx.now)
}

function persistRig(ctx: SettleCtx, actionId: string, rig: RigState, settle: RigSettle): void {
  const ranInWindow = rig.runEndsAt > rig.settledAt
  if (ranInWindow || settle.creditedSec > 0 || settle.state.runEndsAt !== rig.runEndsAt) {
    setRigState(ctx.db, ctx.userId, actionId, settle.state)
    ctx.rigs.set(actionId, settle.state)
  }
}

function mergeInto(into: Record<string, number>, from: Record<string, number>): void {
  for (const [item, n] of Object.entries(from)) into[item] = (into[item] ?? 0) + n
}

const XP_CARRY = '$xp'

function wholeXp(state: RigState, crafted: number): number {
  if (crafted <= 0) return 0
  const earned = crafted * IDLE.xpPerCraft + (state.remainder[XP_CARRY] ?? 0)
  const whole = Math.floor(earned)
  state.remainder[XP_CARRY] = earned - whole
  return whole
}

export function rigRecipe(
  action: ActionDef,
  choiceId: string | undefined,
  progress: ProgressCtx,
): RigRecipe {
  const { bonuses, levels } = progress
  return {
    produces: actionExpected(action, choiceId),
    consumes: actionConsumes(action, choiceId),
    tier: action.tier,
    yieldBonus: bonuses.yield(action.id) + bonuses.double(action.id),
    itemBonus: { coins: bonuses.coins(action.id) },
    successChance: actionOdds(action, choiceId, levels.get(action.id) ?? 1),
  }
}

function capAndPersist(db: Db, userId: UserId, rigs: Map<string, RigState>, now: number): void {
  for (const id of capLiveRigs(rigs, now)) setRigState(db, userId, id, rigs.get(id)!)
}

function writeBank(
  db: Db,
  userId: UserId,
  bank: Map<string, number>,
  before: Map<string, number>,
): void {
  for (const [item, count] of bank) {
    const delta = count - (before.get(item) ?? 0)
    if (delta !== 0) addItems(db, userId, item, delta)
  }
}

export interface DrillRigResult {
  gained: Cost[]
  consumed: Cost[]
  idle: IdleRigView | null
  xp: number
  rigsRunning: number
  maxLiveRigs: number
  stoppedRig: { actionId: string; name: string; skillId: string } | null
}

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

function drillAction(req: DrillReq): DrillRigResult {
  const rand = req.opts.rand ?? Math.random
  const current = getRigState(req.db, req.userId, req.action.id) ?? newRig()
  const choiceId = req.opts.choiceId ?? (current.choice || undefined)
  const strike = drillStrike(req.db, req.bus, req.userId, {
    action: req.action,
    choiceId,
    rand,
    levels: req.report.progress.levels,
  })
  const powered = machinable(req.action, choiceId) ? powerRig(req, current, choiceId) : null
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

function drillStrike(db: Db, bus: EventBus, userId: UserId, req: StrikeReq): DrillStrike {
  const spent = actionConsumes(req.action, req.choiceId)
  if (spent.some((c) => spendableCount(db, userId, c.item) < c.count)) return NO_STRIKE
  const chance = actionOdds(req.action, req.choiceId, req.levels.get(req.action.id) ?? 1)
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

function powerRig(req: DrillReq, current: RigState, choiceId?: string): RigState {
  const powered = extendRig({ ...current, settledAt: req.now, choice: choiceId ?? '' }, req.now)
  setRigState(req.db, req.userId, req.action.id, powered)
  addGatherLog(req.db, req.userId, req.action.id, powered.completions)
  req.report.rigs.set(req.action.id, powered)
  return powered
}

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

function machinable(action: ActionDef, choiceId?: string): boolean {
  if (action.id === 'distill') return true
  return actionConsumes(action, choiceId).length > 0 || actionExpected(action, choiceId).length > 0
}

function drillResult(
  req: DrillReq,
  strike: DrillStrike,
  powered: RigState | null,
  stoppedRig: DrillRigResult['stoppedRig'],
): DrillRigResult {
  const perCraft = req.action.id === 'distill' ? distillPerCraft(req.db, req.userId) : undefined
  const recipe = rigRecipe(req.action, powered?.choice || undefined, req.report.progress)
  return {
    gained: mergeCosts(req.report.gained, strike.gained),
    consumed: mergeCosts(req.report.spent, strike.spent),
    idle: powered ? idleView(powered, req.action, req.now, recipe, perCraft) : null,
    xp: req.settledXp,
    rigsRunning: liveRigCount(req.report.rigs, req.now),
    maxLiveRigs: MAX_LIVE_RIGS,
    stoppedRig,
  }
}

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

export const stopRig = atomic(stopRigTx)

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
  const current = settleRigs(db, bus, userId).rigs.get(actionId) ?? newRig()
  setRigState(db, userId, actionId, { ...current, choice: choiceId })
  return true
}

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
