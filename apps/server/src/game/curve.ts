/**
 * The linear level curve every ladder in the game shares (docs/DESIGN.md §13,
 * §13.5): level `n` costs `base + (n − 1)·step` XP. Player levels, action levels
 * and gem bands differ only in the numbers.
 */

export interface LevelCurve {
  /** XP to finish level 1. */
  base: number
  /** How much more each further level costs. */
  step: number
  /** The level the ladder stops at; unbounded when absent. */
  max?: number
}

export interface CurveLevelInfo {
  level: number
  /** XP accumulated inside the current level */
  intoLevel: number
  /** XP needed to finish the current level */
  forNext: number
  /** 0..1 progress through the current level */
  progress: number
}

/** XP to advance from `level` to the next one. */
export function curveXpForLevel(curve: LevelCurve, level: number): number {
  return curve.base + (level - 1) * curve.step
}

/**
 * Where a running XP total sits on a curve. At `curve.max` the level is pinned
 * with a full bar (`intoLevel === forNext`, progress 1).
 */
export function curveLevelInfo(curve: LevelCurve, xp: number): CurveLevelInfo {
  const max = curve.max ?? Infinity
  let level = 1
  let remaining = Math.max(0, xp)
  while (level < max && remaining >= curveXpForLevel(curve, level)) {
    remaining -= curveXpForLevel(curve, level)
    level++
  }
  const forNext = curveXpForLevel(curve, level)
  if (level >= max) return { level, intoLevel: forNext, forNext, progress: 1 }
  return { level, intoLevel: remaining, forNext, progress: Math.min(1, remaining / forNext) }
}
