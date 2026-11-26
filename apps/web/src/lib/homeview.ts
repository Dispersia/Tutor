import type { ActivityDay, Stats } from './exercises'
import type { IdleRigDTO, SkillsResponse } from './skills'
import { CATEGORY, type CategoryStyle } from './theme'
import { fmtInterval, rigGatheredTotal, rigSecondsLeft } from './idle'

type SkillView = SkillsResponse['skills'][number]
type ActionView = SkillView['actions'][number]
type ItemView = SkillsResponse['items'][number]

const LEVEL_LABELS: Record<string, string> = {
  hsk1: 'HSK 1',
  n5: 'JLPT N5',
  zhfreq: 'Frequency 1k',
}

export function levelLabelFor(lang: string, level: string | null | undefined): string {
  if (lang === 'ja') return 'JLPT N5'
  const label = LEVEL_LABELS[level ?? '']
  if (lang === 'zh') return label && label !== 'JLPT N5' ? label : 'HSK 1'
  return label ?? 'Frequency 1k'
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
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const HEAT_WEEKS = 18

export { HEAT_EMPTY }

export const heatWeeks = (count: number): number => Math.floor(count / 7)

export const heatMax = (days: ActivityDay[]): number => Math.max(1, ...days.map((d) => d.xp))

export const heatDays = (days: ActivityDay[]): ActivityDay[] => days.slice(-(HEAT_WEEKS * 7))

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

export function dayLabel(day: string): string {
  const dt = utcDay(day)
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`
}

export function daySummary(day: ActivityDay, today: string | undefined): string {
  const when = day.day === today ? 'Today' : dayLabel(day.day)
  if (day.xp === 0) return `${when} · no practice`
  if (day.reviews === 0) return `${when} · ${day.xp} XP`
  const cards = day.reviews === 1 ? '1 review' : `${day.reviews} reviews`
  return `${when} · ${day.xp} XP · ${cards}`
}

function heatLevel(xp: number, maxXp: number): number {
  return xp <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((xp / maxXp) * 4)))
}

export function heatFill(level: number): string {
  if (level <= 0) return HEAT_EMPTY
  return `color-mix(in oklab, var(--accent) ${HEAT_FILL[level - 1]}%, var(--color-ink-850))`
}

export function heatCellStyle(
  day: ActivityDay,
  today: string | undefined,
  maxXp: number,
  selected = false,
): string {
  const quiet = today && day.day > today
  const fill = quiet ? 'transparent' : heatFill(heatLevel(day.xp, maxXp))
  const ring = selected ? '; box-shadow: 0 0 0 2px var(--color-ink-100)' : ''
  return `background: ${fill}${ring}`
}

export function monthLabels(days: ActivityDay[], weeks: number): { label: string; span: number }[] {
  const cols: { label: string; span: number }[] = []
  for (let w = 0; w < weeks; w++) {
    const monday = days[w * 7]?.day
    const label = monday ? (MONTHS[utcDay(monday).getUTCMonth()] ?? '') : ''
    const last = cols[cols.length - 1]
    if (last && last.label === label) last.span++
    else cols.push({ label, span: 1 })
  }
  return cols
}

export type TrendGrain = 'day' | 'week' | 'month'

export interface TrendBucket {
  key: string
  axis: string
  title: string
  value: number
}

export interface TrendGeometry {
  line: string
  area: string
  dots: { x: number; y: number }[]
}

const DAY_SPAN = 30
const WEEK_SPAN = 26
const MONTH_SPAN = 12
const CHART_PAD = 8

export function weekStart(day: string): string {
  const dt = utcDay(day)
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7))
  return dt.toISOString().slice(0, 10)
}

function shortDay(day: string): string {
  const dt = utcDay(day)
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`
}

function totalled(days: ActivityDay[], keyOf: (day: string) => string): [string, number][] {
  const totals = new Map<string, number>()
  for (const d of days) {
    const key = keyOf(d.day)
    totals.set(key, (totals.get(key) ?? 0) + d.xp)
  }
  return [...totals.entries()]
}

function dayBuckets(days: ActivityDay[]): TrendBucket[] {
  return days.slice(-DAY_SPAN).map((d) => ({
    key: d.day,
    axis: shortDay(d.day),
    title: dayLabel(d.day),
    value: d.xp,
  }))
}

function weekBuckets(days: ActivityDay[]): TrendBucket[] {
  return totalled(days, weekStart)
    .slice(-WEEK_SPAN)
    .map(([key, value]) => ({ key, axis: shortDay(key), title: `Week of ${shortDay(key)}`, value }))
}

function monthBuckets(days: ActivityDay[]): TrendBucket[] {
  return totalled(days, (day) => day.slice(0, 7))
    .slice(-MONTH_SPAN)
    .map(([key, value]) => ({
      key,
      axis: MONTHS[Number(key.slice(5, 7)) - 1] ?? '',
      title: `${MONTHS[Number(key.slice(5, 7)) - 1] ?? ''} ${key.slice(0, 4)}`,
      value,
    }))
}

export function trendBuckets(
  days: ActivityDay[],
  grain: TrendGrain,
  today?: string,
): TrendBucket[] {
  const live = today ? days.filter((d) => d.day <= today) : days
  if (grain === 'day') return dayBuckets(live)
  if (grain === 'week') return weekBuckets(live)
  return monthBuckets(live)
}

export function trendGeometry(values: number[]): TrendGeometry {
  const max = Math.max(1, ...values)
  const n = values.length
  const round = (v: number) => Math.round(v * 100) / 100
  const dots = values.map((v, i) => ({
    x: round(n <= 1 ? 50 : ((i + 0.5) / n) * 100),
    y: round(100 - CHART_PAD - (v / max) * (100 - CHART_PAD * 2)),
  }))
  const line = dots.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
  return { line, area: dots.length ? `${line} L100 100 L0 100 Z` : '', dots }
}

export interface RigRow {
  actionId: string
  skillId: string
  actionName: string
  icon: string
  category: CategoryStyle
  left: number
  runPct: number
  total: number
  rate: string
  xpPerCraft: number
  yields: string
  choice: string
}

export function rigRows(skills: SkillsResponse | null, now: number): RigRow[] {
  const ctx: RigCtx = {
    items: new Map((skills?.items ?? []).map((i) => [i.id, i])),
    now,
  }
  const out: RigRow[] = []
  for (const s of skills?.skills ?? []) {
    for (const a of s.actions) {
      if (a.idle?.active) out.push(rigRow(s, a, a.idle, ctx))
    }
  }
  return out.sort((x, y) => y.total - x.total)
}

interface RigCtx {
  items: Map<string, ItemView>
  now: number
}

function rigRow(s: SkillView, a: ActionView, idle: IdleRigDTO, ctx: RigCtx): RigRow {
  const left = rigSecondsLeft(idle, ctx.now)
  const total = Object.values(rigGatheredTotal(idle, ctx.now)).reduce((n, v) => n + v, 0)
  return {
    actionId: a.id,
    skillId: s.id,
    actionName: a.name,
    icon: s.icon,
    category: CATEGORY[s.category],
    left,
    runPct: Math.min(1, Math.max(0, left / idle.runSec)),
    total,
    rate: fmtInterval(idle.intervalSec),
    xpPerCraft: idle.xpPerCraft,
    yields: (a.produces ?? []).map((p) => ctx.items.get(p.item)?.name ?? p.item).join(' · '),
    choice: a.choice,
  }
}
