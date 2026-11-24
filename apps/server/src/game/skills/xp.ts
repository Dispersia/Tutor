import { curveLevelInfo, curveXpForLevel, type LevelCurve } from '../curve'
import type { SkillLevelInfo } from './types'

const ACTION_CURVE: LevelCurve = { base: 50, step: 0.25, power: 2 }

export function skillXpForLevel(level: number): number {
  return curveXpForLevel(ACTION_CURVE, level)
}

export function skillLevelInfo(xp: number): SkillLevelInfo {
  return curveLevelInfo(ACTION_CURVE, xp)
}

export const ACTION_MAX_LEVEL = 100

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

export const ACTION_XP_TO_MAX = 84_575
