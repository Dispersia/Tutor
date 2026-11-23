/** Level curve (docs/DESIGN.md §13). Each level needs a bit more XP than the last. */

import { curveLevelInfo, curveXpForLevel, type LevelCurve } from './curve'

/** The player ladder: 100 XP for level 1, 50 more each level, no cap. */
const PLAYER_CURVE: LevelCurve = { base: 100, step: 50 }

export function xpForLevel(level: number): number {
  return curveXpForLevel(PLAYER_CURVE, level)
}

export interface LevelInfo {
  level: number
  /** XP accumulated inside the current level */
  intoLevel: number
  /** XP needed to finish the current level */
  forNext: number
  /** 0..1 progress through the current level */
  progress: number
}

export function levelInfo(xp: number): LevelInfo {
  return curveLevelInfo(PLAYER_CURVE, xp)
}
