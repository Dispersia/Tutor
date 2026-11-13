/** Aggregates per-level profession effects + owned talents into concrete bonuses. */

import type { Mod, ModKind, SkillId } from './skills'
import { SKILLS } from './skills'
import type { TalentDef } from './talents'

export interface Bonuses {
  /** extra XP applied to every profession (fraction) */
  globalXp: number
  xp: (skill: SkillId) => number
  yield: (skill: SkillId) => number
  double: (skill: SkillId) => number
  coins: (skill: SkillId) => number
  damage: number
  drop: number
  hp: number
}

export function computeBonuses(levels: Map<SkillId, number>, talents: TalentDef[]): Bonuses {
  const mods: Mod[] = []
  for (const s of SKILLS) {
    const lvl = levels.get(s.id) ?? 1
    mods.push({ ...s.effect, value: s.effect.value * Math.max(0, lvl - 1) })
  }
  for (const t of talents) mods.push(...t.mods)

  const sum = (kind: ModKind, skill?: SkillId): number =>
    mods
      .filter(
        (m) => m.kind === kind && (skill === undefined ? m.skill === undefined : m.skill === skill),
      )
      .reduce((n, m) => n + m.value, 0)

  return {
    globalXp: sum('global_xp'),
    xp: (skill) => sum('xp', skill),
    yield: (skill) => sum('yield', skill),
    double: (skill) => sum('double', skill),
    coins: (skill) => sum('coins', skill),
    damage: sum('damage'),
    drop: sum('drop'),
    hp: sum('hp'),
  }
}

/**
 * Applies a yield bonus + a "double" roll to a base quantity.
 * `rand` is injectable so tests are deterministic.
 */
export function applyYield(
  base: number,
  yieldBonus: number,
  doubleChance: number,
  rand: () => number = Math.random,
): number {
  const scaled = base * (1 + yieldBonus)
  let out = Math.floor(scaled)
  if (rand() < scaled - out) out += 1
  if (rand() < doubleChance) out += base
  return Math.max(0, out)
}
