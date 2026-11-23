export interface LevelCurve {
  base: number
  step: number
  max?: number
}

export interface CurveLevelInfo {
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

export function curveXpForLevel(curve: LevelCurve, level: number): number {
  return curve.base + (level - 1) * curve.step
}

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
