import type { Mod, ModKind, SkillId } from './skills'
import { ACTION_BY_ID, ACTIONS, SKILL_BY_ID, skillLevelsFrom } from './skills'
import type { TalentDef } from './talents'

export interface Bonuses {
  globalXp: number
  xp: (actionId: string) => number
  yield: (actionId: string) => number
  double: (actionId: string) => number
  coins: (actionId: string) => number
  damage: number
  drop: number
  hp: number
}

interface Leveled {
  actionId: string
  skillId: SkillId
  mod: Mod
}

export function computeBonuses(levels: Map<string, number>, talents: TalentDef[]): Bonuses {
  const leveled = leveledEffects(levels)
  const talentMods = talentModsOf(talents, levels)
  const forAction = (actionId: string, kind: ModKind) =>
    actionBonus(leveled, talentMods, actionId, kind)
  const global = (kind: ModKind) => globalBonus(leveled, talentMods, kind)
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

function leveledEffects(levels: Map<string, number>): Leveled[] {
  const leveled: Leveled[] = []
  for (const a of ACTIONS) {
    const effect = SKILL_BY_ID.get(a.skillId)?.effect
    if (!effect) continue
    const value = effect.value * Math.max(0, (levels.get(a.id) ?? 1) - 1)
    if (value === 0) continue
    leveled.push({ actionId: a.id, skillId: a.skillId, mod: { ...effect, value } })
  }
  return leveled
}

function talentModsOf(talents: TalentDef[], levels: Map<string, number>): Mod[] {
  const derived = skillLevelsFrom(levels)
  return talents
    .flatMap((t) => t.mods)
    .map((m) => (m.synergy ? { ...m, value: m.value * (derived.get(m.synergy) ?? 1) } : m))
}

function actionBonus(
  leveled: Leveled[],
  talentMods: Mod[],
  actionId: string,
  kind: ModKind,
): number {
  const skillId = ACTION_BY_ID.get(actionId)?.skillId
  const own = leveled
    .filter((l) => l.actionId === actionId && l.mod.kind === kind)
    .reduce((n, l) => n + l.mod.value, 0)
  const scoped = talentMods
    .filter((m) => m.kind === kind && m.skill === skillId)
    .reduce((n, m) => n + m.value, 0)
  return own + scoped
}

function globalBonus(leveled: Leveled[], talentMods: Mod[], kind: ModKind): number {
  const fromActions = leveled
    .filter((l) => l.mod.kind === kind)
    .reduce((n, l) => n + l.mod.value, 0)
  const fromTalents = talentMods.filter((m) => m.kind === kind).reduce((n, m) => n + m.value, 0)
  return fromActions + fromTalents
}

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
