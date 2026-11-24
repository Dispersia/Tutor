import { expect, test } from 'bun:test'
import type { ActivityDay } from './exercises'
import {
  daySummary,
  HEAT_WEEKS,
  heatDays,
  trendBuckets,
  trendGeometry,
  weekStart,
} from './homeview'

function addDays(day: string, n: number): string {
  const dt = new Date(`${day}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function series(start: string, n: number, xp: (i: number) => number): ActivityDay[] {
  return Array.from({ length: n }, (_, i) => {
    const value = xp(i)
    return { day: addDays(start, i), xp: value, reviews: value > 0 ? 1 : 0 }
  })
}

test('heatDays keeps the newest whole weeks of a longer series', () => {
  const days = series('2026-01-01', 400, () => 5)
  const shown = heatDays(days)
  expect(HEAT_WEEKS * 7).toBeLessThan(days.length)
  expect(shown.length).toBe(HEAT_WEEKS * 7)
  expect(shown[0]!.day).toBe(days[days.length - HEAT_WEEKS * 7]!.day)
  expect(shown[shown.length - 1]!.day).toBe(days[days.length - 1]!.day)
})

test('weekStart returns the Monday of the day', () => {
  expect(weekStart('2026-11-16')).toBe('2026-11-16')
  expect(weekStart('2026-11-22')).toBe('2026-11-16')
  expect(weekStart('2026-11-23')).toBe('2026-11-23')
})

test('daySummary names the day, its xp and its reviews', () => {
  expect(daySummary({ day: '2026-11-22', xp: 120, reviews: 14 }, '2026-11-22')).toBe(
    'Today · 120 XP · 14 reviews',
  )
  expect(daySummary({ day: '2026-11-21', xp: 60, reviews: 1 }, '2026-11-22')).toBe(
    'Sat 21 Nov · 60 XP · 1 review',
  )
  expect(daySummary({ day: '2026-11-20', xp: 0, reviews: 0 }, '2026-11-22')).toBe(
    'Fri 20 Nov · no practice',
  )
  expect(daySummary({ day: '2026-11-19', xp: 40, reviews: 0 }, '2026-11-22')).toBe(
    'Thu 19 Nov · 40 XP',
  )
})

test('day buckets are one point per day over the last month', () => {
  const buckets = trendBuckets(
    series('2026-11-16', 40, (i) => i),
    'day',
  )
  expect(buckets.length).toBe(30)
  expect(buckets[0]!.value).toBe(10)
  expect(buckets[29]!.value).toBe(39)
  expect(buckets[0]!.axis).toBe('26 Nov')
  expect(buckets[29]!.axis).toBe('25 Dec')
  expect(buckets[0]!.title).toBe('Thu 26 Nov')
})

test('trendBuckets stops at today and leaves the padded week out', () => {
  const days = series('2026-11-16', 14, () => 10)
  const daily = trendBuckets(days, 'day', '2026-11-23')
  expect(daily.length).toBe(8)
  expect(daily[daily.length - 1]!.key).toBe('2026-11-23')
  const weekly = trendBuckets(days, 'week', '2026-11-23')
  expect(weekly.length).toBe(2)
  expect(weekly[0]!.value).toBe(70)
  expect(weekly[1]!.value).toBe(10)
})

test('week buckets sum the xp of each Monday-to-Sunday week', () => {
  const buckets = trendBuckets(
    series('2026-11-16', 14, () => 10),
    'week',
  )
  expect(buckets.length).toBe(2)
  expect(buckets[0]!.key).toBe('2026-11-16')
  expect(buckets[0]!.value).toBe(70)
  expect(buckets[1]!.value).toBe(70)
  expect(buckets[1]!.title).toBe('Week of 23 Nov')
})

test('month buckets sum the xp of each calendar month', () => {
  const buckets = trendBuckets(
    series('2026-11-16', 31, () => 10),
    'month',
  )
  expect(buckets.length).toBe(2)
  expect(buckets[0]!.key).toBe('2026-11')
  expect(buckets[0]!.value).toBe(150)
  expect(buckets[0]!.title).toBe('Nov 2026')
  expect(buckets[1]!.key).toBe('2026-12')
  expect(buckets[1]!.value).toBe(160)
})

test('trendGeometry spreads the points across the box', () => {
  const { line, area, dots } = trendGeometry([0, 5, 10])
  expect(dots).toEqual([
    { x: 16.67, y: 92 },
    { x: 50, y: 50 },
    { x: 83.33, y: 8 },
  ])
  expect(line).toBe('M16.67 92 L50 50 L83.33 8')
  expect(area.endsWith('L100 100 L0 100 Z')).toBe(true)
})

test('trendGeometry draws a flat line when there is no activity', () => {
  const { dots } = trendGeometry([0, 0])
  expect(dots.map((d) => d.y)).toEqual([92, 92])
  expect(trendGeometry([]).area).toBe('')
})
