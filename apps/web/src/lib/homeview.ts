import type { ActivityDay, Stats } from './exercises'
import type { IdleRigDTO, SkillsResponse } from './skills'
import { CATEGORY, type CategoryStyle } from './theme'
import { fmtInterval, rigGainedSince, rigSecondsLeft } from './idle'

type SkillView = SkillsResponse['skills'][number]
type ActionView = SkillView['actions'][number]
type ItemView = SkillsResponse['items'][number]

const LEVEL_LABELS: Record<string, string> = {
  hsk1: 'HSK 1',
  n5: 'JLPT N5',
  zhfreq: 'Frequency 1k',
}

export function levelLabelFor(lang: string, level: string | null | undefined): string {
  const raw = LEVEL_LABELS[level ?? '']
  if (lang === 'ja') return raw === 'JLPT N5' ? raw : 'JLPT N5'
  if (lang === 'zh') return raw === 'HSK 1' || raw === 'Frequency 1k' ? raw : 'HSK 1'
  return raw ?? 'Frequency 1k'
}

export function xpToGoal(stats: Stats | null): number {
  return stats ? Math.max(0, stats.dailyGoal - stats.dailyXp) : 0
}

export function bankSummary(skills: SkillsResponse | null): {
  coins: number
  kinds: number
  worn: number
} {
  const inventory = (skills?.inventory ?? []).filter((i) => i.count > 0)
  return {
    coins: inventory.find((i) => i.itemId === 'coins')?.count ?? 0,
    kinds: inventory.length,
    worn: skills?.equipment.length ?? 0,
  }
}

const HEAT_EMPTY = 'var(--color-ink-800)'
const HEAT_FILL = [28, 50, 72, 100]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export { HEAT_EMPTY }

export const heatWeeks = (count: number): number => Math.floor(count / 7)

export const heatMax = (days: ActivityDay[]): number => Math.max(1, ...days.map((d) => d.xp))

export function heatLevel(xp: number, maxXp: number): number {
  return xp <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((xp / maxXp) * 4)))
}

export function heatFill(level: number): string {
  if (level <= 0) return HEAT_EMPTY
  return `color-mix(in oklab, var(--accent) ${HEAT_FILL[level - 1]}%, var(--color-ink-850))`
}

export function heatCellStyle(day: ActivityDay, today: string | undefined, maxXp: number): string {
  if (today && day.day > today) return 'background: transparent'
  return `background: ${heatFill(heatLevel(day.xp, maxXp))}`
}

export function monthLabels(days: ActivityDay[], weeks: number): { label: string; span: number }[] {
  const cols: { label: string; span: number }[] = []
  for (let w = 0; w < weeks; w++) {
    const monday = days[w * 7]?.day
    const label = monday ? (MONTHS[new Date(`${monday}T00:00:00Z`).getUTCMonth()] ?? '') : ''
    const last = cols[cols.length - 1]
    if (last && last.label === label) last.span++
    else cols.push({ label, span: 1 })
  }
  return cols
}

export interface RigRow {
  actionId: string
  skillId: string
  actionName: string
  icon: string
  category: CategoryStyle
  left: number
  runPct: number
  made: number
  rate: string
  xpPerCraft: number
  yields: string
}

export function rigRows(skills: SkillsResponse | null, fetchedAt: number, now: number): RigRow[] {
  const ctx: RigCtx = {
    items: new Map((skills?.items ?? []).map((i) => [i.id, i])),
    fetchedAt,
    now,
  }
  const out: RigRow[] = []
  for (const s of skills?.skills ?? []) {
    for (const a of s.actions) {
      if (a.idle?.active) out.push(rigRow(s, a, a.idle, ctx))
    }
  }
  return out.sort((x, y) => y.made - x.made)
}

interface RigCtx {
  items: Map<string, ItemView>
  fetchedAt: number
  now: number
}

function rigRow(s: SkillView, a: ActionView, idle: IdleRigDTO, ctx: RigCtx): RigRow {
  const left = rigSecondsLeft(idle, ctx.now)
  const made = ctx.fetchedAt
    ? Object.values(rigGainedSince(idle, ctx.fetchedAt, ctx.now)).reduce((n, v) => n + v, 0)
    : 0
  return {
    actionId: a.id,
    skillId: s.id,
    actionName: a.name,
    icon: s.icon,
    category: CATEGORY[s.category],
    left,
    runPct: Math.min(1, Math.max(0, left / idle.runSec)),
    made,
    rate: fmtInterval(idle.intervalSec),
    xpPerCraft: idle.xpPerCraft,
    yields: (a.produces ?? []).map((p) => ctx.items.get(p.item)?.name ?? p.item).join(' · '),
  }
}
