/** Action levels, profession levels and the aggregate bonuses (docs/DESIGN.md §13.5). */

import { getActionXp, listActionProgress, listTalents, setActionXp } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { computeBonuses, type Bonuses } from '../game/modifiers'
import { ACTION_BY_ID, actionLevelInfo, actionsForSkill, type SkillId } from '../game/skills'
import { resolveTalents } from '../game/talents'

/** Every action's level for a user; actions never trained sit at level 1. */
export function actionLevelMap(db: Db, userId: string): Map<string, number> {
  return new Map(
    listActionProgress(db, userId).map((r) => [r.actionId, actionLevelInfo(r.xp).level]),
  )
}

export function actionLevelOf(
  db: Db,
  userId: string,
  actionId: string,
  levels?: Map<string, number>,
): number {
  return (levels ?? actionLevelMap(db, userId)).get(actionId) ?? 1
}

/** The action-level map and the bonuses derived from it, loaded once per request. */
export interface ProgressCtx {
  levels: Map<string, number>
  bonuses: Bonuses
}

/** Loads the action-level map once and derives the bonuses from that same map. */
export function loadProgress(db: Db, userId: string): ProgressCtx {
  const levels = actionLevelMap(db, userId)
  return { levels, bonuses: aggregateBonuses(db, userId, levels) }
}

/**
 * A profession's level — the **mean** of its actions' levels, so it always reads
 * out of 100 however much content the profession has. Adding an action (a new ore,
 * say) raises the denominator and so lowers the level until you train it: that is
 * the point, a maxed profession stays 100 and old progress is "reduced by the new
 * available levels".
 */
export function skillLevelOf(
  db: Db,
  userId: string,
  skillId: SkillId,
  levels?: Map<string, number>,
): number {
  const acts = actionsForSkill(skillId)
  if (!acts.length) return 1
  const map = levels ?? actionLevelMap(db, userId)
  const total = acts.reduce((n, a) => n + (map.get(a.id) ?? 1), 0)
  return Math.round(total / acts.length)
}

/** The action a profession-awarded XP lands on (combat has one action per skill). */
export function primaryActionId(skillId: SkillId): string {
  return actionsForSkill(skillId)[0]!.id
}

export function aggregateBonuses(
  db: Db,
  userId: string,
  levels?: Map<string, number>,
): Bonuses {
  return computeBonuses(
    levels ?? actionLevelMap(db, userId),
    resolveTalents(listTalents(db, userId)),
  )
}

export interface ActionAward {
  actionId: string
  skillId: SkillId
  /** the action's total XP after the award */
  xp: number
  /** the action's own level after the award */
  level: number
  /** the profession's derived level after the award */
  skillLevel: number
  /** the action levelled up */
  leveledUp: boolean
  /** XP actually credited (after bonuses) */
  gained: number
  /** the profession milestone whose talent choice just opened up (or null) */
  talentUnlocked: number | null
}

/** One XP award: which action, how much raw XP, and the shared request context. */
export interface XpAward {
  actionId: string
  amount: number
  /**
   * From `loadProgress`, when awarding several actions in a row — the bonuses and
   * the action-level map are then shared, and the map is updated in place with this
   * action's new level.
   */
  ctx?: ProgressCtx
}

/** Credits XP to one action. */
export function awardActionXp(
  db: Db,
  bus: EventBus,
  userId: string,
  award: XpAward,
): ActionAward {
  const { actionId, amount, ctx } = award
  const action = ACTION_BY_ID.get(actionId)!
  const beforeXp = getActionXp(db, userId, actionId)
  const bonus = ctx?.bonuses ?? aggregateBonuses(db, userId)
  const gained = Math.max(0, Math.round(amount * (1 + bonus.xp(actionId) + bonus.globalXp)))
  const xp = beforeXp + gained
  const info = actionLevelInfo(xp)
  const before = actionLevelInfo(beforeXp).level
  const skillBefore = skillLevelOf(db, userId, action.skillId, ctx?.levels)
  setActionXp(db, userId, actionId, xp, info.level)
  ctx?.levels.set(actionId, info.level)
  bus.emit('skill.xp', {
    userId,
    actionId,
    skillId: action.skillId,
    amount: gained,
    xp,
    level: info.level,
  })

  const leveledUp = info.level > before
  let talentUnlocked: number | null = null
  if (leveledUp) {
    bus.emit('skill.level.up', {
      userId,
      actionId,
      skillId: action.skillId,
      level: info.level,
    })
    const skillLevel = skillLevelOf(db, userId, action.skillId, ctx?.levels)
    const milestone = Math.floor(skillLevel / 10) * 10
    if (milestone >= 10 && milestone > skillBefore) talentUnlocked = milestone
  }
  return {
    actionId,
    skillId: action.skillId,
    xp,
    level: info.level,
    skillLevel: skillLevelOf(db, userId, action.skillId, ctx?.levels),
    leveledUp,
    gained,
    talentUnlocked,
  }
}
