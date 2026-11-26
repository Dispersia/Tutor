import type { UserId } from '../ids'
import { listActionProgress, listEquipment, listInventory, spendableCount } from '../db/repo'
import type { Db } from '../db/client'
import { BAND_BY_ID, type BandId } from '../game/bands'
import {
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  actionConsumes,
  actionLevelInfo,
  actionsForSkill,
  bandLevelRequired,
  missingUnlocks,
  type ActionDef,
  type Cost,
  type UnlockReq,
} from '../game/skills'
import { bandLevelMap } from './bands'
import { skillLevelOf } from './progress'

export interface ActionProgress {
  actionId: string
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

export function actionProgressView(db: Db, userId: UserId): Map<string, ActionProgress> {
  return new Map(
    listActionProgress(db, userId).map((r) => [
      r.actionId,
      { actionId: r.actionId, xp: r.xp, ...actionLevelInfo(r.xp) },
    ]),
  )
}

export function skillSummaries(db: Db, userId: UserId, byAction?: Map<string, ActionProgress>) {
  const actions = byAction ?? actionProgressView(db, userId)
  const levels = new Map([...actions].map(([id, p]) => [id, p.level]))
  return SKILLS.map((s) => {
    const acts = actionsForSkill(s.id)
    const rows = acts.map((a) => actions.get(a.id))
    const level = skillLevelOf(db, userId, s.id, levels)
    const xp = rows.reduce((n, r) => n + (r?.xp ?? 0), 0)
    const progress = acts.length
      ? rows.reduce((n, r) => n + (r?.progress ?? 0), 0) / acts.length
      : 0
    return { skillId: s.id, xp, level, intoLevel: 0, forNext: 0, progress }
  })
}

export function accountLevel(db: Db, userId: UserId): { level: number; progress: number } {
  const profs = skillSummaries(db, userId)
  if (!profs.length) return { level: 1, progress: 0 }
  const mean = profs.reduce((n, p) => n + p.level, 0) / profs.length
  const progress = profs.reduce((n, p) => n + p.progress, 0) / profs.length
  return { level: Math.min(100, Math.max(1, Math.round(mean))), progress }
}

export function inventoryView(db: Db, userId: UserId) {
  const counts = new Map(listInventory(db, userId).map((r) => [r.itemId, r.count]))
  return ITEMS.map((i) => ({ itemId: i.id, count: counts.get(i.id) ?? 0 }))
}

interface BandGate {
  id: BandId
  name: string
  level: number
  current: number
}

export interface ActionState {
  unlocked: boolean
  missingUnlocks: UnlockReq[]
  affordable: boolean
  missing: Cost[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
  band: BandGate | null
  missingBands: BandGate[]
}

export interface ActionStateCtx {
  levels?: Map<string, number>
  bandLevels?: Map<BandId, number>
}

export function actionState(
  db: Db,
  userId: UserId,
  action: ActionDef,
  choiceId?: string,
  ctx: ActionStateCtx = {},
): ActionState {
  const missingUnlocksList = missingUnlocks(action, (s) => skillLevelOf(db, userId, s, ctx.levels))
  const consumes = actionConsumes(action, choiceId)
  const missing = consumes.filter((c) => spendableCount(db, userId, c.item) < c.count)
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

function bandGate(
  action: ActionDef,
  bandLevels: Map<BandId, number>,
): { band: BandGate | null; missingBands: BandGate[] } {
  const def = action.band ? BAND_BY_ID.get(action.band) : undefined
  if (!action.band || !def) return { band: null, missingBands: [] }
  const band: BandGate = {
    id: action.band,
    name: def.name ?? action.band,
    level: bandLevelRequired(action),
    current: bandLevels.get(action.band) ?? 1,
  }
  return { band, missingBands: def.after ? afterGate(def.after, bandLevels) : [] }
}

function afterGate(
  after: { band: BandId; level: number },
  bandLevels: Map<BandId, number>,
): BandGate[] {
  const current = bandLevels.get(after.band) ?? 1
  if (current >= after.level) return []
  const name = BAND_BY_ID.get(after.band)?.name ?? after.band
  return [{ id: after.band, name, level: after.level, current }]
}

function equipGate(db: Db, userId: UserId, action: ActionDef) {
  if (!action.equip) return { equipOk: true, equipMissing: null }
  const eq = listEquipment(db, userId).find((e) => e.slot === action.equip!.slot)
  const item = eq ? ITEM_BY_ID.get(eq.itemId) : undefined
  const ok = Boolean(item?.tags?.includes(action.equip.tag))
  return { equipOk: ok, equipMissing: ok ? null : action.equip }
}
