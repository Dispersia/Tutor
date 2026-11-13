/** Level curve (docs/DESIGN.md §13). Each level needs a bit more XP than the last. */

export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 50
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
  let level = 1
  let remaining = Math.max(0, xp)
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level)
    level++
  }
  const forNext = xpForLevel(level)
  return { level, intoLevel: remaining, forNext, progress: Math.min(1, remaining / forNext) }
}
