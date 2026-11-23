import { craftsToItems, formatInterval } from '@tutor/core'
import type { IdleRigDTO, SkillDTO } from './skills'

export const fmtInterval = formatInterval

export function rigGainedSince(
  rig: IdleRigDTO | null,
  since: number,
  now: number,
): Record<string, number> {
  if (!rig?.active) return {}
  const end = Math.min(now, rig.runEndsAt)
  const dt = (end - since) / 1000
  if (dt <= 0 || rig.intervalSec <= 0) return {}
  return craftsToItems(dt / rig.intervalSec, rig.produces, 1 + rig.yieldBonus)
}

export function rigSecondsLeft(rig: IdleRigDTO | null, now: number): number {
  if (!rig) return 0
  return Math.max(0, Math.round((rig.runEndsAt - now) / 1000))
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (m === 0) return `${h}h`
  if (m === 60) return `${h + 1}h`
  return `${h}h ${m}m`
}

export function itemRigs(skills: SkillDTO[]): Map<string, IdleRigDTO> {
  const map = new Map<string, IdleRigDTO>()
  for (const s of skills) {
    for (const a of s.actions) {
      if (!a.idle?.active) continue
      for (const p of a.idle.produces) {
        if (!map.has(p.item)) map.set(p.item, a.idle)
      }
    }
  }
  return map
}

export function anyRigActive(skills: SkillDTO[]): boolean {
  return skills.some((s) => s.actions.some((a) => a.idle?.active))
}
