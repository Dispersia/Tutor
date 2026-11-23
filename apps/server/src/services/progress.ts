import type { UserId } from '../ids'
import { getActionXp, listActionProgress, listTalents, setActionXp } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { computeBonuses, type Bonuses } from '../game/modifiers'
import {
  ACTION_BY_ID,
  actionLevelInfo,
  actionsForSkill,
  type ActionDef,
  type SkillId,
} from '../game/skills'
import { resolveTalents } from '../game/talents'

export function actionLevelMap(db: Db, userId: UserId): Map<string, number> {
  return new Map(
    listActionProgress(db, userId).map((r) => [r.actionId, actionLevelInfo(r.xp).level]),
  )
}

export function actionLevelOf(
  db: Db,
  userId: UserId,
  actionId: string,
  levels?: Map<string, number>,
): number {
  return (levels ?? actionLevelMap(db, userId)).get(actionId) ?? 1
}

export interface ProgressCtx {
  levels: Map<string, number>
  bonuses: Bonuses
}

export function loadProgress(db: Db, userId: UserId): ProgressCtx {
  const levels = actionLevelMap(db, userId)
  return { levels, bonuses: aggregateBonuses(db, userId, levels) }
}

export function skillLevelOf(
  db: Db,
  userId: UserId,
  skillId: SkillId,
  levels?: Map<string, number>,
): number {
  const acts = actionsForSkill(skillId)
  if (!acts.length) return 1
  const map = levels ?? actionLevelMap(db, userId)
  const total = acts.reduce((n, a) => n + (map.get(a.id) ?? 1), 0)
  return Math.round(total / acts.length)
}

export function primaryActionId(skillId: SkillId): string {
  return actionsForSkill(skillId)[0]!.id
}

export function aggregateBonuses(db: Db, userId: UserId, levels?: Map<string, number>): Bonuses {
  return computeBonuses(
    levels ?? actionLevelMap(db, userId),
    resolveTalents(listTalents(db, userId)),
  )
}

export interface ActionAward {
  actionId: string
  skillId: SkillId
  xp: number
  level: number
  skillLevel: number
  leveledUp: boolean
  gained: number
  talentUnlocked: number | null
}

export interface XpAward {
  actionId: string
  amount: number
  ctx?: ProgressCtx
}

export function awardActionXp(db: Db, bus: EventBus, userId: UserId, award: XpAward): ActionAward {
  const { actionId, amount, ctx } = award
  const action = ACTION_BY_ID.get(actionId)!
  const levels = ctx?.levels ?? actionLevelMap(db, userId)
  const bonuses = ctx?.bonuses ?? aggregateBonuses(db, userId, levels)
  const beforeXp = getActionXp(db, userId, actionId)
  const gained = Math.max(0, Math.round(amount * (1 + bonuses.xp(actionId) + bonuses.globalXp)))
  const credited = creditXp(db, bus, { userId, actionId, action, beforeXp, gained, levels })
  return { actionId, skillId: action.skillId, gained, ...credited }
}

interface CreditReq {
  userId: UserId
  actionId: string
  action: ActionDef
  beforeXp: number
  gained: number
  levels: Map<string, number>
}

function creditXp(db: Db, bus: EventBus, req: CreditReq) {
  const { userId, actionId, action, beforeXp, gained, levels } = req
  const xp = beforeXp + gained
  const info = actionLevelInfo(xp)
  const before = actionLevelInfo(beforeXp).level
  const skillBefore = skillLevelOf(db, userId, action.skillId, levels)
  setActionXp(db, userId, actionId, xp, info.level)
  levels.set(actionId, info.level)
  const skillLevel = skillLevelOf(db, userId, action.skillId, levels)
  emitXp({ bus, userId, action, actionId, gained, xp, level: info.level })
  const leveledUp = info.level > before
  const talentUnlocked = leveledUp
    ? unlockedTalent({ bus, userId, action, level: info.level, skillBefore, skillLevel })
    : null
  return { xp, level: info.level, skillLevel, leveledUp, talentUnlocked }
}

interface XpEvent {
  bus: EventBus
  userId: UserId
  action: ActionDef
  actionId: string
  gained: number
  xp: number
  level: number
}

function emitXp(e: XpEvent): void {
  e.bus.emit('skill.xp', {
    userId: e.userId,
    actionId: e.actionId,
    skillId: e.action.skillId,
    amount: e.gained,
    xp: e.xp,
    level: e.level,
  })
}

interface LevelUp {
  bus: EventBus
  userId: UserId
  action: ActionDef
  level: number
  skillBefore: number
  skillLevel: number
}

function unlockedTalent(up: LevelUp): number | null {
  up.bus.emit('skill.level.up', {
    userId: up.userId,
    actionId: up.action.id,
    skillId: up.action.skillId,
    level: up.level,
  })
  const milestone = Math.floor(up.skillLevel / 10) * 10
  return milestone >= 10 && milestone > up.skillBefore ? milestone : null
}
