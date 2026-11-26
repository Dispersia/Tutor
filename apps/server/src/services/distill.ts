import type { UserId } from '../ids'
import { getItemCount, getUserSetting, setUserSetting } from '../db/repo'
import type { Db } from '../db/client'
import { rigAdvance, type RigSettle, type RigState } from '../game/idle'
import {
  DISTILL_XP_PER_VALUE,
  ITEM_BY_ID,
  essenceFamily,
  essenceId,
  itemValue,
  type ItemDef,
} from '../game/skills'

export type DistillMode = 'max-value' | 'min-value'

export interface DistillConfig {
  mode: DistillMode
  allow: string[]
}

const MODES: DistillMode[] = ['max-value', 'min-value']
const KEY = 'distill'
const FALLBACK: DistillConfig = { mode: 'max-value', allow: [] }

export function getDistillConfig(db: Db, userId: UserId): DistillConfig {
  const raw = getUserSetting(db, userId, KEY)
  if (!raw) return { ...FALLBACK, allow: [] }
  try {
    return parseConfig(JSON.parse(raw) as Partial<DistillConfig>)
  } catch {
    return { ...FALLBACK, allow: [] }
  }
}

function parseConfig(parsed: Partial<DistillConfig>): DistillConfig {
  const mode = MODES.includes(parsed.mode as DistillMode)
    ? (parsed.mode as DistillMode)
    : 'max-value'
  const allow = Array.isArray(parsed.allow)
    ? parsed.allow.filter(
        (id): id is string => typeof id === 'string' && Boolean(ITEM_BY_ID.get(id)),
      )
    : []
  return { mode, allow }
}

export function distillMode(mode: string): DistillMode | undefined {
  return MODES.includes(mode as DistillMode) ? (mode as DistillMode) : undefined
}

export function setDistillMode(db: Db, userId: UserId, mode: DistillMode): DistillConfig {
  const next = { ...getDistillConfig(db, userId), mode }
  save(db, userId, next)
  return next
}

export function toggleDistillItem(db: Db, userId: UserId, itemId: string): DistillConfig {
  const item = ITEM_BY_ID.get(itemId)
  const current = getDistillConfig(db, userId)
  if (!item || item.tier === 'coin') return current
  const allow = new Set(current.allow)
  if (allow.has(itemId)) allow.delete(itemId)
  else allow.add(itemId)
  const next = { ...current, allow: [...allow] }
  save(db, userId, next)
  return next
}

function save(db: Db, userId: UserId, config: DistillConfig): void {
  setUserSetting(db, userId, KEY, JSON.stringify(config))
}

export function distillXp(item: ItemDef): number {
  return Math.max(1, Math.round(itemValue(item) * DISTILL_XP_PER_VALUE))
}

export function distillPerCraft(db: Db, userId: UserId): number {
  const config = getDistillConfig(db, userId)
  const target = distillTarget(config, (id) => getItemCount(db, userId, id))
  return target ? distillXp(target) : 0
}

export function distillTarget(
  config: DistillConfig,
  stock: (itemId: string) => number,
): ItemDef | undefined {
  let best: ItemDef | undefined
  let bestValue = 0
  for (const id of config.allow) {
    const item = ITEM_BY_ID.get(id)
    if (!item || stock(id) <= 0) continue
    const value = itemValue(item)
    const better = config.mode === 'max-value' ? value > bestValue : value < bestValue
    if (!best || better) {
      best = item
      bestValue = value
    }
  }
  return best
}

export interface DistillBurn {
  settle: RigSettle
  xp: number
}

export function distillBurn(
  rig: RigState,
  tier: number,
  bank: Map<string, number>,
  config: DistillConfig,
  now: number,
): DistillBurn {
  const { next, idle, sec, wanted, active } = rigAdvance(rig, tier, now)
  if (!active) return { settle: idle, xp: 0 }
  next.crafts = wanted - Math.floor(wanted)
  const burn = burnStock(bank, config, Math.floor(wanted))
  return { settle: settleFrom(next, sec, now, burn), xp: burn.xp }
}

interface Burn {
  items: Record<string, number>
  essence: Record<string, number>
  xp: number
}

function burnStock(bank: Map<string, number>, config: DistillConfig, count: number): Burn {
  const items: Record<string, number> = {}
  const essence: Record<string, number> = {}
  let xp = 0
  for (let left = count; left > 0; left--) {
    const item = distillTarget(config, (id) => bank.get(id) ?? 0)
    if (!item) break
    bank.set(item.id, (bank.get(item.id) ?? 0) - 1)
    items[item.id] = (items[item.id] ?? 0) + 1
    const id = essenceId(essenceFamily(item))
    bank.set(id, (bank.get(id) ?? 0) + 1)
    essence[id] = (essence[id] ?? 0) + 1
    xp += distillXp(item)
  }
  return { items, essence, xp }
}

function settleFrom(next: RigState, sec: number, now: number, burn: Burn): RigSettle {
  const crafted = Object.values(burn.items).reduce((n, v) => n + v, 0)
  return {
    state: next,
    produced: burn.essence,
    consumed: burn.items,
    crafted,
    creditedSec: sec,
    running: next.runEndsAt > now,
  }
}
