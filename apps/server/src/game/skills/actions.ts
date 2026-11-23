import { BAND_BY_ID } from '../bands'
import type { ActionChoice, ActionDef, Cost, LootEntry, SkillId, UnlockReq } from './types'
import { ACTIONS } from './actions.data'
import { SKILLS } from './skills.data'

export function weaponSkill(tags: string[] | undefined): SkillId {
  if (tags?.includes('bow')) return 'ranged'
  if (tags?.includes('staff')) return 'magic'
  return 'strength'
}

export function actionRequiredLevel(action: ActionDef): number {
  if (action.band) {
    const band = BAND_BY_ID.get(action.band)
    if (band) return band.tier * 1000 + (action.bandLevel ?? 1)
  }
  return (action.requires ?? []).reduce((n, r) => Math.max(n, r.level), 1)
}

export function actionsForSkill(skillId: SkillId): ActionDef[] {
  let list = bySkill.get(skillId)
  if (!list) bySkill.set(skillId, (list = sortedActions(skillId)))
  return list
}

const bySkill = new Map<SkillId, ActionDef[]>()

function sortedActions(skillId: SkillId): ActionDef[] {
  return ACTIONS.filter((a) => a.skillId === skillId).sort(
    (a, b) => actionRequiredLevel(a) - actionRequiredLevel(b) || a.tier - b.tier,
  )
}

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

export function tableExpected(table: LootEntry[]): Cost[] {
  const total = table.reduce((n, e) => n + Math.max(0, e.weight), 0) || 1
  const out = new Map<string, number>()
  for (const e of table) {
    const p = Math.max(0, e.weight) / total
    out.set(e.item, (out.get(e.item) ?? 0) + p * (e.count ?? 1))
  }
  return [...out].map(([item, count]) => ({ item, count }))
}

export function actionChoice(action: ActionDef, choiceId?: string): ActionChoice | undefined {
  const list = action.choices
  if (!list?.length) return undefined
  return list.find((c) => c.id === choiceId) ?? list[0]
}

export function actionConsumes(action: ActionDef, choiceId?: string): Cost[] {
  const c = actionChoice(action, choiceId)
  return c ? (c.consumes ?? []) : (action.consumes ?? [])
}

export function actionExpected(action: ActionDef, choiceId?: string): Cost[] {
  const c = actionChoice(action, choiceId)
  const table = c ? c.table : action.table
  if (table) return tableExpected(table)
  return (c ? c.produces : action.produces) ?? []
}

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

export function actionOdds(action: ActionDef, choiceId: string | undefined, level: number): number {
  const c = actionChoice(action, choiceId)
  const base = c ? c.successChance : action.successChance
  if (!base || base >= 1) return 1
  const per = (c ? c.successPerLevel : action.successPerLevel) ?? 0
  return Math.min(1, Math.max(0, base + per * (level - 1)))
}
