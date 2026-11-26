import type {
  ActionDTO,
  BandDTO,
  DistillConfigDTO,
  ItemDTO,
  OwnedTalent,
  SkillDTO,
  TalentOption,
} from './skills'
import type { ModKind } from './types'
import { CATEGORY, type SkillCategory } from './theme'
import { fmtInterval, rigGainedSince, rigSecondsLeft } from './idle'

export const EMBLEM: Record<SkillCategory, string> = {
  gathering: '⛏️',
  artisan: '🔨',
  support: '🧭',
  combat: '⚔️',
}

export const compact = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString()

export interface RunningRig {
  id: string
  name: string
  accent: string
  gained: number
  actionId: string
  left: number
  rate: string
  count: number
}

export function runningRigs(skills: SkillDTO[], fetchedAt: number, now: number): RunningRig[] {
  const out: RunningRig[] = []
  for (const s of skills) {
    const rig = runningIn(s, fetchedAt, now)
    if (rig) out.push(rig)
  }
  return out.sort((a, b) => a.left - b.left)
}

function runningIn(s: SkillDTO, fetchedAt: number, now: number): RunningRig | undefined {
  const active = s.actions.filter((a) => a.idle?.active)
  if (!active.length) return undefined
  const soonest = active.reduce((min, a) =>
    rigSecondsLeft(a.idle!, now) < rigSecondsLeft(min.idle!, now) ? a : min,
  )
  return {
    id: s.id,
    name: s.name,
    accent: CATEGORY[s.category].accent,
    gained: fetchedAt ? gainedSince(active, fetchedAt, now) : 0,
    actionId: soonest.id,
    left: rigSecondsLeft(soonest.idle!, now),
    rate: fmtInterval(soonest.idle!.intervalSec),
    count: active.length,
  }
}

function gainedSince(actions: ActionDTO[], fetchedAt: number, now: number): number {
  let gained = 0
  for (const a of actions) {
    for (const n of Object.values(rigGainedSince(a.idle!, fetchedAt, now))) gained += n
  }
  return gained
}

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

function bandGate(a: ActionDTO): string {
  const missing = a.missingBands ?? []
  if (missing.length) return missing.map((b) => `${b.name} ${b.level}`).join(', ')
  if (a.band && a.band.current < a.band.level) return `${a.band.name} ${a.band.level}`
  return ''
}

export function bandBuff(b: BandDTO): string {
  const v = b.buffValue ?? 0
  if (!v) return ''
  return b.buffStat === 'stamina'
    ? `+${Math.round(v)} stamina`
    : `+${Math.round(v * 1000) / 10}% ${b.buffStat}`
}

export function actionGate(a: ActionDTO): string {
  const band = bandGate(a)
  if (band) return band
  if (a.missingUnlocks.length)
    return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
  if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
  return ''
}

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

export function unmetOf(o: TalentOption): string {
  return (o.requires ?? [])
    .filter((r) => !r.met)
    .map((r) => `needs ${r.skill} ${r.level}`)
    .join(', ')
}

export const isBlocked = (o: TalentOption): boolean => (o.requires ?? []).some((r) => !r.met)

export const pct = (v: number): string => `${Math.round(v * 100)}%`

export interface Distillable {
  itemId: string
  count: number
  name: string
  icon: string
  value: number
}

function queuedRow(
  itemId: string,
  counts: Map<string, number>,
  itemMap: Map<string, ItemDTO>,
): Distillable | null {
  const item = itemMap.get(itemId)
  if (!item) return null
  return {
    itemId,
    count: counts.get(itemId) ?? 0,
    name: item.name,
    icon: item.icon,
    value: item.value ?? 0,
  }
}

export function queuedDistillables(
  config: DistillConfigDTO,
  inventory: { itemId: string; count: number }[],
  itemMap: Map<string, ItemDTO>,
): Distillable[] {
  const counts = new Map(inventory.map((row) => [row.itemId, row.count]))
  return config.allow
    .map((itemId) => queuedRow(itemId, counts, itemMap))
    .filter((d): d is Distillable => d !== null)
    .sort((a, b) => b.value - a.value)
}

export interface TalentRow {
  milestone: number
  kind: 'choice' | 'mastery'
  state: 'done' | 'open' | 'locked'
  owned?: OwnedTalent
  options: TalentOption[]
}

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
