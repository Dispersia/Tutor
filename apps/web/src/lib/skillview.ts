/**
 * Pure derivations for the profession page: labels, gates and the band/talent
 * groupings. No runes, no DOM — the page owns the state, this owns the maths.
 */

import type { ActionDTO, BandDTO, OwnedTalent, SkillDTO, TalentOption } from './skills'
import type { ModKind } from './types'

/** Short labels for each passive kind, so a raw "18%" can't be read as progress. */
export const EFFECT_LABEL: Record<ModKind, string> = {
  yield: 'yield',
  double: 'bonus product',
  xp: 'XP',
  coins: 'coins',
  global_xp: 'global XP',
  damage: 'power',
  drop: 'rare drops',
  hp: 'HP',
}

/** The band gate blocking an action, if any (e.g. `Bronze 40`). */
export function bandGate(a: ActionDTO): string {
  const missing = a.missingBands ?? []
  if (missing.length) return missing.map((b) => `${b.name} ${b.level}`).join(', ')
  if (a.band && a.band.current < a.band.level) return `${a.band.name} ${a.band.level}`
  return ''
}

/** The band's current total contribution, e.g. `+4.2% crit` or `+5 stamina`. */
export function bandBuff(b: BandDTO): string {
  const v = b.buffValue ?? 0
  if (!v) return ''
  return b.buffStat === 'stamina'
    ? `+${Math.round(v)} stamina`
    : `+${Math.round(v * 1000) / 10}% ${b.buffStat}`
}

/**
 * The gate that blocks an action, without restating missing materials that the
 * cost chips already show. A level or equip gate is the only thing the chips
 * cannot explain.
 */
export function actionGate(a: ActionDTO): string {
  const band = bandGate(a)
  if (band) return band
  if (a.missingUnlocks.length)
    return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
  if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
  return ''
}

/** Why a "train" button is disabled: band, level, equip, then missing materials. */
export function lockedReason(a: ActionDTO, nameOf: (itemId: string) => string): string {
  const band = bandGate(a)
  if (band) return band
  if (a.missingUnlocks.length) {
    return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
  }
  if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
  if (a.missing.length) return a.missing.map((m) => `${m.count}× ${nameOf(m.item)}`).join(', ')
  return ''
}

/** The unmet cross-profession requirements of a talent option, as text. */
export function unmetOf(o: TalentOption): string {
  return (o.requires ?? [])
    .filter((r) => !r.met)
    .map((r) => `needs ${r.skill} ${r.level}`)
    .join(', ')
}

/** A capstone option carries a cross-profession gate; choice options never do. */
export const isBlocked = (o: TalentOption): boolean => (o.requires ?? []).some((r) => !r.met)

/** One row of the talent rail: a choice milestone or a mastery capstone. */
export interface TalentRow {
  milestone: number
  kind: 'choice' | 'mastery'
  state: 'done' | 'open' | 'locked'
  owned?: OwnedTalent
  options: TalentOption[]
}

/**
 * The whole talent ladder in one rail: a choice every 10 levels, with a mastery
 * capstone alongside the Lv 50 and Lv 100 rows. Locked milestones stay visible,
 * so the ladder (and what is still coming) reads as a path.
 */
export function buildTalentRail(s: SkillDTO): TalentRow[] {
  const rows: TalentRow[] = []
  for (let m = 10; m <= 100; m += 10) {
    rows.push(choiceRow(s, m))
    const mastery = masteryRow(s, m)
    if (mastery) rows.push(mastery)
  }
  return rows
}

function choiceRow(s: SkillDTO, m: number): TalentRow {
  const chosen = s.talent.owned.find((t) => t.milestone === m)
  const open = s.talent.pendingChoice && s.talent.milestone === m
  return {
    milestone: m,
    kind: 'choice',
    state: chosen ? 'done' : open ? 'open' : 'locked',
    owned: chosen,
    options: open ? s.talent.options : [],
  }
}

function masteryRow(s: SkillDTO, m: number): TalentRow | undefined {
  if (!s.talent.mastery.milestones.includes(m)) return undefined
  const capstone = s.talent.mastery.owned.find((t) => t.milestone === m)
  const open = s.talent.mastery.pending.find((p) => p.milestone === m)
  return {
    milestone: m,
    kind: 'mastery',
    state: capstone ? 'done' : open ? 'open' : 'locked',
    owned: capstone,
    options: open?.options ?? [],
  }
}

/**
 * Actions grouped under their material band. Only artisans with bands
 * (Smithing) get the grouped view; anything else renders the flat list.
 */
export function buildBandGroups(
  s: SkillDTO,
): { groups: { band: BandDTO; actions: ActionDTO[] }[]; other: ActionDTO[] } | null {
  const bands = s.bands ?? []
  if (!bands.length) return null
  const { byBand, other } = groupByBand(s.actions)
  return {
    groups: bands.map((band) => ({ band, actions: byBand.get(band.id) ?? [] })),
    other,
  }
}

function groupByBand(actions: ActionDTO[]) {
  const byBand = new Map<string, ActionDTO[]>()
  const other: ActionDTO[] = []
  for (const a of actions) {
    if (a.band) {
      const list = byBand.get(a.band.id) ?? []
      list.push(a)
      byBand.set(a.band.id, list)
    } else {
      other.push(a)
    }
  }
  return { byBand, other }
}
