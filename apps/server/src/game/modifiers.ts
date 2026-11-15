/** Aggregates per-action profession effects + owned talents into concrete bonuses. */

import type { Mod, ModKind, SkillId } from './skills'
import { ACTION_BY_ID, ACTIONS, SKILL_BY_ID } from './skills'
import type { TalentDef } from './talents'

export interface Bonuses {
  /** extra XP applied to every profession (fraction) */
  globalXp: number
  xp: (actionId: string) => number
  yield: (actionId: string) => number
  double: (actionId: string) => number
  coins: (actionId: string) => number
  damage: number
  drop: number
  hp: number
}

/** A profession effect scaled by one action's own level. */
interface Leveled {
  actionId: string
  skillId: SkillId
  mod: Mod
}

/**
 * `levels` maps **action** id → level. Each action carries its profession's
 * passive scaled by its *own* level, so `Mine copper` Lv 5 gives +4% copper while
 * `Mine essence` Lv 1 gives nothing. Talents stay scoped to a whole profession
 * (`mod.skill`) and boost every action under it.
 */
export function computeBonuses(levels: Map<string, number>, talents: TalentDef[]): Bonuses {
  const leveled: Leveled[] = []
  for (const a of ACTIONS) {
    const effect = SKILL_BY_ID.get(a.skillId)?.effect
    if (!effect) continue
    const value = effect.value * Math.max(0, (levels.get(a.id) ?? 1) - 1)
    if (value === 0) continue
    leveled.push({ actionId: a.id, skillId: a.skillId, mod: { ...effect, value } })
  }
  const talentMods = talents.flatMap((t) => t.mods)

  /** The action's own passive + talents scoped to its profession. */
  const forAction = (actionId: string, kind: ModKind): number => {
    const skillId = ACTION_BY_ID.get(actionId)?.skillId
    const own = leveled
      .filter((l) => l.actionId === actionId && l.mod.kind === kind)
      .reduce((n, l) => n + l.mod.value, 0)
    const fromTalents = talentMods
      .filter((m) => m.kind === kind && m.skill === skillId)
      .reduce((n, m) => n + m.value, 0)
    return own + fromTalents
  }

  /** Kinds that are global (they ignore scope) sum across every action + talent. */
  const global = (kind: ModKind): number =>
    leveled.filter((l) => l.mod.kind === kind).reduce((n, l) => n + l.mod.value, 0) +
    talentMods.filter((m) => m.kind === kind).reduce((n, m) => n + m.value, 0)

  return {
    globalXp: global('global_xp'),
    xp: (actionId) => forAction(actionId, 'xp'),
    yield: (actionId) => forAction(actionId, 'yield'),
    double: (actionId) => forAction(actionId, 'double'),
    coins: (actionId) => forAction(actionId, 'coins'),
    damage: global('damage'),
    drop: global('drop'),
    hp: global('hp'),
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
