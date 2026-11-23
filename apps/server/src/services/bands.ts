/** Material tier bands and the enchant tokens gear carries (docs/DESIGN.md §13.5.3). */

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
import { ACTION_BY_ID, ACTIONS, ENCHANT_BY_ID, type EnchantDef, type ItemDef } from '../game/skills'

/** Parse a gear instance's enchant list (band ids, or `gem:<type>` tokens). */
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

/** The enchant a crafted piece carries (one per piece; §13.5.3.2). */
export function enchantOf(instance: { enchantJson: string }): EnchantDef | undefined {
  const id = parseEnchants(instance.enchantJson)[0]
  return id ? ENCHANT_BY_ID.get(id) : undefined
}

/**
 * Every band's **score** for a user — the summed XP of that band's actions,
 * levelled on the same curve an action uses. Any item of the band feeds the same
 * score, so you never level a dozen near-identical actions to move on.
 */
export function bandXpMap(db: Db, userId: string): Map<BandId, number> {
  const out = new Map<BandId, number>()
  for (const row of listActionProgress(db, userId)) {
    const action = ACTION_BY_ID.get(row.actionId)
    if (!action?.band) continue
    out.set(action.band, (out.get(action.band) ?? 0) + row.xp)
  }
  return out
}

export function bandLevelMap(db: Db, userId: string): Map<BandId, number> {
  const xp = bandXpMap(db, userId)
  const out = new Map<BandId, number>()
  // Every band reads at least level 1, so its entry action is never gated away.
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
  /** which stat the band's passive grows */
  buffStat: BandStat
  /** the account-wide bonus this band grants *right now* (fraction/flat by stat) */
  buffValue: number
  enchantLabel: string
  /** Enchanting level needed to spend this band's reagent */
  enchantLevel: number
  gearTotal: number
  gearUnlocked: number
  /** the next gear this band unlocks, so the page can tease it */
  nextUnlock: { level: number; name: string } | null
}

/** The band board for an artisan page: each metal with its shared score. */
export function bandView(db: Db, userId: string): BandView[] {
  const xpByBand = bandXpMap(db, userId)
  return BANDS.map((band) => {
    const xp = xpByBand.get(band.id) ?? 0
    const info = bandLevelInfo(xp)
    const gear = ACTIONS.filter((a) => a.band === band.id)
    const gearUnlocked = gear.filter((a) => (a.bandLevel ?? 1) <= info.level).length
    const locked = gear.filter((a) => (a.bandLevel ?? 1) > info.level)
    const next = locked.length
      ? locked.reduce((m, a) => ((a.bandLevel ?? 1) < (m.bandLevel ?? 1) ? a : m))
      : null
    return {
      id: band.id,
      name: band.name,
      icon: band.icon,
      tier: band.tier,
      xp,
      ...info,
      gearUnlockLevel: band.gearUnlockLevel,
      buffLabel: band.buff.label,
      buffStat: band.buff.stat,
      buffValue: band.buff.value * Math.max(0, info.level - 1),
      enchantLabel: band.enchant.label,
      enchantLevel: band.enchantLevel,
      gearTotal: gear.length,
      gearUnlocked,
      nextUnlock: next ? { level: next.bandLevel ?? 1, name: next.name } : null,
    }
  })
}

/** The account-wide passive every band level grants (crit, lifesteal, …). */
export function accountBandBonuses(db: Db, userId: string): BandBonuses {
  return bandBonuses(bandLevelMap(db, userId))
}

/**
 * The band a piece of gear belongs to, by its crafting line and item level. Bows and
 * staves form the `wood` line; armour families map 1:1. Used to pick the salvage
 * reagent, so a salvaged piece yields its own tier's feedstock.
 */
export function bandForItem(item: ItemDef): BandDef | undefined {
  const line = item.tags?.includes('bow') || item.tags?.includes('staff') ? 'wood' : item.armourType
  if (!line) return undefined
  const tier = Math.max(1, Math.round(item.itemLevel ?? 1))
  return BANDS.find((b) => b.line === line && b.tier === tier)
}
