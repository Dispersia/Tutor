import { curveLevelInfo, curveXpForLevel, type LevelCurve } from './curve'

const PLAYER_CURVE: LevelCurve = { base: 100, step: 50 }

export const DEFAULT_DAILY_GOAL = 50

export function xpForLevel(level: number): number {
  return curveXpForLevel(PLAYER_CURVE, level)
}

export interface LevelInfo {
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

export function levelInfo(xp: number): LevelInfo {
  return curveLevelInfo(PLAYER_CURVE, xp)
}
