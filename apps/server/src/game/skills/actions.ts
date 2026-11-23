/**
 * Action queries and rolls (docs/DESIGN.md §13.5.3.1).
 */

import { BAND_BY_ID } from '../bands'
import type { ActionChoice, ActionDef, Cost, LootEntry, SkillId, UnlockReq } from './types'
import { ACTIONS } from './actions.data'
import { SKILLS } from './skills.data'

/**
 * The combat profession a weapon trains. A fight uses whatever you have
 * equipped, so the weapon's tag — not the monster — decides the skill: a melee
 * weapon (sword) trains Strength, a bow trains Ranged, a staff trains Magic.
 * Fighting unarmed is still melee, so it falls back to Strength.
 */
export function weaponSkill(tags: string[] | undefined): SkillId {
  if (tags?.includes('bow')) return 'ranged'
  if (tags?.includes('staff')) return 'magic'
  return 'strength'
}

/**
 * The level an action unlocks at — the highest level any of its `requires`
 * asks for. An action with no requirements is available from level 1. A banded
 * action instead sorts by `tier·1000 + bandLevel`, so a metal's whole set reads
 * together before the next metal starts (§13.5.3).
 */
export function actionRequiredLevel(action: ActionDef): number {
  if (action.band) {
    const band = BAND_BY_ID.get(action.band)
    if (band) return band.tier * 1000 + (action.bandLevel ?? 1)
  }
  return (action.requires ?? []).reduce((n, r) => Math.max(n, r.level), 1)
}

/**
 * A profession's actions, in progression order: the lowest level requirement
 * first, then tier, so a recipe line reads bronze → bronze gear → iron → …
 * instead of by the order the actions happen to be declared in.
 */
export function actionsForSkill(skillId: SkillId): ActionDef[] {
  return ACTIONS.filter((a) => a.skillId === skillId).sort(
    (a, b) => actionRequiredLevel(a) - actionRequiredLevel(b) || a.tier - b.tier,
  )
}

/**
 * Each profession's **derived** level (the mean of its actions' levels, rounded)
 * from a map of action id → level. The same formula `skillLevelOf` uses against
 * the database, but pure — so `computeBonuses` can resolve synergy talents without
 * touching the db.
 */
export function skillLevelsFrom(levels: Map<string, number>): Map<SkillId, number> {
  const out = new Map<SkillId, number>()
  for (const s of SKILLS) {
    const acts = actionsForSkill(s.id)
    if (!acts.length) {
      out.set(s.id, 1)
      continue
    }
    const total = acts.reduce((n, a) => n + Math.max(1, levels.get(a.id) ?? 1), 0)
    out.set(s.id, Math.round(total / acts.length))
  }
  return out
}

export function missingUnlocks(action: ActionDef, levelOf: (s: SkillId) => number): UnlockReq[] {
  return (action.requires ?? []).filter((r) => levelOf(r.skill) < r.level)
}

export function missingMaterials(action: ActionDef, countOf: (i: string) => number): Cost[] {
  return (action.consumes ?? []).filter((c) => countOf(c.item) < c.count)
}

/** Weighted draw from an action's gem table (§13.5.3.1). `rand` is injectable. */
export function rollTable(table: LootEntry[], rand: () => number = Math.random): Cost {
  const total = table.reduce((n, e) => n + Math.max(0, e.weight), 0)
  let r = rand() * total
  for (const e of table) {
    r -= Math.max(0, e.weight)
    if (r < 0) return { item: e.item, count: e.count ?? 1 }
  }
  const last = table[table.length - 1]!
  return { item: last.item, count: last.count ?? 1 }
}

/**
 * Expected produces for a table action. Idle folds the odds into the rig's rate, so
 * a running prospect pays each gem at its share — over time, the whole tier.
 */
export function tableExpected(table: LootEntry[]): Cost[] {
  const total = table.reduce((n, e) => n + Math.max(0, e.weight), 0) || 1
  const out = new Map<string, number>()
  for (const e of table) {
    const p = Math.max(0, e.weight) / total
    out.set(e.item, (out.get(e.item) ?? 0) + p * (e.count ?? 1))
  }
  return [...out].map(([item, count]) => ({ item, count }))
}

/** The choice an action runs (the named one, or its first). Undefined when it has none. */
export function actionChoice(action: ActionDef, choiceId?: string): ActionChoice | undefined {
  const list = action.choices
  if (!list?.length) return undefined
  return list.find((c) => c.id === choiceId) ?? list[0]
}

/** What an action (or one of its choices) consumes. */
export function actionConsumes(action: ActionDef, choiceId?: string): Cost[] {
  const c = actionChoice(action, choiceId)
  return c ? (c.consumes ?? []) : (action.consumes ?? [])
}

/** Expected produces — fixed, or the expected value of a gem table. */
export function actionExpected(action: ActionDef, choiceId?: string): Cost[] {
  const c = actionChoice(action, choiceId)
  const table = c ? c.table : action.table
  if (table) return tableExpected(table)
  return (c ? c.produces : action.produces) ?? []
}

/** One roll of an action: a single table entry, or its fixed produces. */
export function actionRoll(
  action: ActionDef,
  choiceId: string | undefined,
  rand: () => number = Math.random,
): Cost[] {
  const c = actionChoice(action, choiceId)
  const table = c ? c.table : action.table
  if (table) return [rollTable(table, rand)]
  return (c ? c.produces : action.produces) ?? []
}

/** The success odds of an action (or choice) at the given level. */
export function actionOdds(action: ActionDef, choiceId: string | undefined, level: number): number {
  const c = actionChoice(action, choiceId)
  const base = c ? c.successChance : action.successChance
  if (!base || base >= 1) return 1
  const per = (c ? c.successPerLevel : action.successPerLevel) ?? 0
  return Math.min(1, Math.max(0, base + per * (level - 1)))
}
