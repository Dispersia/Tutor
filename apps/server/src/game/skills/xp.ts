/**
 * The profession XP curves (docs/DESIGN.md §13.5): the action-level curve and the
 * level-100 cap the profession mean is built from.
 */

import { curveLevelInfo, curveXpForLevel, type LevelCurve } from '../curve'
import type { SkillLevelInfo } from './types'

// --- skill XP curve ----------------------------------------------------------

/**
 * The action ladder, uncapped here: `actionLevelInfo` applies the level-100 cap
 * itself, on top of the uncapped level.
 */
const ACTION_CURVE: LevelCurve = { base: 100, step: 10 }

/**
 * XP to advance one **action** level. Kept linear so the level-100 cap stays
 * reachable, but scaled for the idle era: a rig left running earns XP on its own
 * (every craft pays, docs §13.5.1), so the whole curve sits 10× higher than the
 * drill-only days — ~58.4k XP maxes one action, and a whole 4-action profession
 * is ~234k. A full 3-hour run of a maxed rig is worth ~2.7k XP, so capping an
 * action is ~22 "leave it running" sessions, not one.
 */
export function skillXpForLevel(level: number): number {
  return curveXpForLevel(ACTION_CURVE, level)
}

export function skillLevelInfo(xp: number): SkillLevelInfo {
  return curveLevelInfo(ACTION_CURVE, xp)
}

/**
 * The most any **action** can reach. The profession level is the mean of its
 * actions, so this cap is what makes a profession read out of 100: a maxed
 * 4-action profession is level 100, and adding a 5th action lowers it again.
 */
export const ACTION_MAX_LEVEL = 100

/** An action's level info, capped at `ACTION_MAX_LEVEL` (progress pinned at 100%). */
export function actionLevelInfo(xp: number): SkillLevelInfo {
  const info = skillLevelInfo(xp)
  if (info.level < ACTION_MAX_LEVEL) return info
  return {
    level: ACTION_MAX_LEVEL,
    intoLevel: info.forNext,
    forNext: info.forNext,
    progress: 1,
  }
}

/** Action XP the ladder costs from level 1 to level 100 (`ACTION_MAX_LEVEL`). */
export const ACTION_XP_TO_MAX = 58_410
