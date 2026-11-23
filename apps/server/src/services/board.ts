/** The professions board: per-action/profession state and the action gate. */

import { getItemCount, listActionProgress, listEquipment, listInventory } from '../db/repo'
import type { Db } from '../db/client'
import { BAND_BY_ID, type BandId } from '../game/bands'
import {
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  actionConsumes,
  actionExpected,
  actionLevelInfo,
  actionOdds,
  actionsForSkill,
  missingUnlocks,
  type ActionDef,
  type Cost,
  type UnlockReq,
} from '../game/skills'
import { bandLevelMap } from './bands'
import { actionLevelOf, skillLevelOf } from './progress'

export interface ActionProgress {
  actionId: string
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

/** Per-action XP + level (actions never trained are absent — callers default to 1). */
export function actionProgressView(db: Db, userId: string): Map<string, ActionProgress> {
  return new Map(
    listActionProgress(db, userId).map((r) => [
      r.actionId,
      { actionId: r.actionId, xp: r.xp, ...actionLevelInfo(r.xp) },
    ]),
  )
}

/**
 * Per-profession summary with its **derived** level (the sum of its actions). The
 * profession has no XP bar of its own, so `progress` is the average of its
 * actions' progress toward their next level. Pass the action map when the caller
 * already built one (see `loadPlayerCtx`).
 */
export function skillSummaries(db: Db, userId: string, byAction?: Map<string, ActionProgress>) {
  const actions = byAction ?? actionProgressView(db, userId)
  return SKILLS.map((s) => {
    const acts = actionsForSkill(s.id)
    const rows = acts.map((a) => actions.get(a.id))
    // the mean of the action levels: reads out of 100, and a new action lowers it
    const level = acts.length
      ? Math.round(rows.reduce((n, r) => n + (r?.level ?? 1), 0) / acts.length)
      : 1
    const xp = rows.reduce((n, r) => n + (r?.xp ?? 0), 0)
    const progress = acts.length
      ? rows.reduce((n, r) => n + (r?.progress ?? 0), 0) / acts.length
      : 0
    return { skillId: s.id, xp, level, intoLevel: 0, forNext: 0, progress }
  })
}

/**
 * The **account level** (docs/DESIGN.md §13): the mean of every profession's own
 * level, so it reads out of 100 exactly like a profession does — "percent
 * complete", 1 at the start and 100 when every action is maxed. It is *derived*,
 * never stored: it climbs as your professions climb (both the drills and the idle
 * rigs feed them) and **drops when a new profession or action is added**, because
 * the average gains a denominator you have not trained yet. That is intended.
 */
export function accountLevel(db: Db, userId: string): { level: number; progress: number } {
  const profs = skillSummaries(db, userId)
  if (!profs.length) return { level: 1, progress: 0 }
  const mean = profs.reduce((n, p) => n + p.level, 0) / profs.length
  const progress = profs.reduce((n, p) => n + p.progress, 0) / profs.length
  return { level: Math.min(100, Math.max(1, Math.round(mean))), progress }
}

export function inventoryView(db: Db, userId: string) {
  const counts = new Map(listInventory(db, userId).map((r) => [r.itemId, r.count]))
  return ITEMS.map((i) => ({ itemId: i.id, count: counts.get(i.id) ?? 0 }))
}

export interface BandGate {
  id: BandId
  name: string
  /** the level this action asks for */
  level: number
  /** the player's current band score */
  current: number
}

export interface ActionState {
  unlocked: boolean
  missingUnlocks: UnlockReq[]
  affordable: boolean
  missing: Cost[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
  /** the band this action belongs to and the level it unlocks at, or null */
  band: BandGate | null
  /** cross-band gates not yet met (e.g. iron needs Bronze 40) */
  missingBands: BandGate[]
}

/** Per-request maps for the action gate, so a board render reads them once. */
export interface ActionStateCtx {
  levels?: Map<string, number>
  bandLevels?: Map<BandId, number>
}

export function actionState(
  db: Db,
  userId: string,
  action: ActionDef,
  choiceId?: string,
  ctx: ActionStateCtx = {},
): ActionState {
  const missingUnlocksList = missingUnlocks(action, (s) => skillLevelOf(db, userId, s, ctx.levels))
  // Cost depends on the chosen recipe (prospect this ore, cut that gem).
  const consumes = actionConsumes(action, choiceId)
  const missing = consumes.filter((c) => getItemCount(db, userId, c.item) < c.count)
  const { band, missingBands } = bandGate(action, ctx.bandLevels ?? bandLevelMap(db, userId))
  const { equipOk, equipMissing } = equipGate(db, userId, action)
  return buildState({ missingUnlocksList, missing, band, missingBands, equipOk, equipMissing })
}

interface StateParts {
  missingUnlocksList: UnlockReq[]
  missing: Cost[]
  band: BandGate | null
  missingBands: BandGate[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
}

function buildState(p: StateParts): ActionState {
  const bandOk = !p.band || p.band.current >= p.band.level
  return {
    unlocked:
      p.missingUnlocksList.length === 0 && bandOk && p.missingBands.length === 0 && p.equipOk,
    missingUnlocks: p.missingUnlocksList,
    affordable: p.missing.length === 0,
    missing: p.missing,
    equipOk: p.equipOk,
    equipMissing: p.equipMissing,
    band: p.band,
    missingBands: p.missingBands,
  }
}

/** This action's band and the prerequisite tier that still blocks it. */
function bandGate(
  action: ActionDef,
  bandLevels: Map<BandId, number>,
): { band: BandGate | null; missingBands: BandGate[] } {
  const def = action.band ? BAND_BY_ID.get(action.band) : undefined
  if (!action.band || !def) return { band: null, missingBands: [] }
  const band: BandGate = {
    id: action.band,
    name: def.name ?? action.band,
    level: action.bandLevel ?? 1,
    current: bandLevels.get(action.band) ?? 1,
  }
  return { band, missingBands: def.after ? afterGate(def.after, bandLevels) : [] }
}

/** A tier's whole band stays shut until the tier below reached its level (§13.5.3). */
function afterGate(
  after: { band: BandId; level: number },
  bandLevels: Map<BandId, number>,
): BandGate[] {
  const current = bandLevels.get(after.band) ?? 1
  if (current >= after.level) return []
  const name = BAND_BY_ID.get(after.band)?.name ?? after.band
  return [{ id: after.band, name, level: after.level, current }]
}

/** Whether the action's required gear tag is actually worn. */
function equipGate(db: Db, userId: string, action: ActionDef) {
  if (!action.equip) return { equipOk: true, equipMissing: null }
  const eq = listEquipment(db, userId).find((e) => e.slot === action.equip!.slot)
  const item = eq ? ITEM_BY_ID.get(eq.itemId) : undefined
  const ok = Boolean(item?.tags?.includes(action.equip.tag))
  return { equipOk: ok, equipMissing: ok ? null : action.equip }
}

/**
 * The chance an action actually yields its output, at the player's current level
 * (§13.5.3.1). Prospecting always consumes its ore, so a miss is a real cost — the
 * odds rise with the action's level, so skill beats the gamble.
 */
export function actionSuccessChance(
  db: Db,
  userId: string,
  action: ActionDef,
  choiceId?: string,
  levels?: Map<string, number>,
): number {
  const level = actionLevelOf(db, userId, action.id, levels)
  return actionOdds(action, choiceId, level)
}

/** The items an action yields — fixed, or the expected value of its gem table. */
export function actionProduces(action: ActionDef, choiceId?: string): Cost[] {
  return actionExpected(action, choiceId)
}
