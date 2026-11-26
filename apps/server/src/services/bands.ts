import type { UserId } from '../ids'
import { listActionProgress } from '../db/repo'
import type { Db } from '../db/client'
import {
  BANDS,
  bandBonuses,
  bandLevelInfo,
  type BandBonuses,
  type BandDef,
  type BandId,
  type BandStat,
} from '../game/bands'
import {
  ACTION_BY_ID,
  ACTIONS,
  ENCHANT_BY_ID,
  bandLevelRequired,
  type ActionDef,
  type EnchantDef,
  type ItemDef,
} from '../game/skills'

export function parseEnchants(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

export function enchantOf(instance: { enchantJson: string }): EnchantDef | undefined {
  const id = parseEnchants(instance.enchantJson)[0]
  return id ? ENCHANT_BY_ID.get(id) : undefined
}

type ActionXp = ReadonlyMap<string, { xp: number }>

function bandXpMap(actionXp: ActionXp): Map<BandId, number> {
  const out = new Map<BandId, number>()
  for (const [actionId, row] of actionXp) {
    const action = ACTION_BY_ID.get(actionId)
    if (!action?.band) continue
    out.set(action.band, (out.get(action.band) ?? 0) + row.xp)
  }
  return out
}

function actionXpRows(db: Db, userId: UserId): ActionXp {
  return new Map(listActionProgress(db, userId).map((r) => [r.actionId, r]))
}

export function bandLevelMap(db: Db, userId: UserId): Map<BandId, number> {
  const xp = bandXpMap(actionXpRows(db, userId))
  const out = new Map<BandId, number>()
  for (const band of BANDS) out.set(band.id, bandLevelInfo(xp.get(band.id) ?? 0).level)
  return out
}

export interface BandView {
  id: BandId
  name: string
  icon: string
  tier: number
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
  gearUnlockLevel: number
  buffLabel: string
  buffStat: BandStat
  buffValue: number
  enchantLabel: string
  enchantLevel: number
  gearTotal: number
  gearUnlocked: number
  nextUnlock: { level: number; name: string } | null
}

export function bandView(db: Db, userId: UserId, actionXp?: ActionXp): BandView[] {
  const xpByBand = bandXpMap(actionXp ?? actionXpRows(db, userId))
  return BANDS.map((band) => bandViewOf(band, xpByBand.get(band.id) ?? 0))
}

function bandViewOf(band: BandDef, xp: number): BandView {
  const info = bandLevelInfo(xp)
  const gear = ACTIONS.filter((a) => a.band === band.id)
  const locked = gear.filter((a) => bandLevelRequired(a) > info.level)
  return {
    id: band.id,
    name: band.name,
    icon: band.icon,
    tier: band.tier,
    xp,
    ...info,
    ...bandLabels(band, info.level),
    gearTotal: gear.length,
    gearUnlocked: gear.length - locked.length,
    nextUnlock: nextUnlock(locked),
  }
}

function bandLabels(band: BandDef, level: number) {
  return {
    gearUnlockLevel: band.gearUnlockLevel,
    buffLabel: band.buff.label,
    buffStat: band.buff.stat,
    buffValue: band.buff.value * Math.max(0, level - 1),
    enchantLabel: band.enchant.label,
    enchantLevel: band.enchantLevel,
  }
}

function nextUnlock(locked: ActionDef[]): { level: number; name: string } | null {
  if (!locked.length) return null
  const next = locked.reduce((m, a) => (bandLevelRequired(a) < bandLevelRequired(m) ? a : m))
  return { level: bandLevelRequired(next), name: next.name }
}

export function accountBandBonuses(db: Db, userId: UserId): BandBonuses {
  return bandBonuses(bandLevelMap(db, userId))
}

export function bandForItem(item: ItemDef): BandDef | undefined {
  const line = item.tags?.includes('bow') || item.tags?.includes('staff') ? 'wood' : item.armourType
  if (!line) return undefined
  const tier = Math.max(1, Math.round(item.itemLevel ?? 1))
  return BANDS.find((b) => b.line === line && b.tier === tier)
}
