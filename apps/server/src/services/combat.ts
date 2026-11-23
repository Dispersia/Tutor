/** Combat: the player's loadout numbers, encounters and consumables (docs/DESIGN.md §13.5). */

import {
  getGearInstance,
  getPlayerHp,
  getUserSetting,
  listEquipment,
  listInventory,
  upsertEncounter,
} from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { MONSTER_BY_ID, playerMaxHp, playerPower, type MonsterDef } from '../game/combat'
import {
  activeSetBonuses,
  addStats,
  applySetBonuses,
  deriveStats,
  emptyStats,
  gearScore,
  parseStats,
  statsOf,
  type ActiveSetBonus,
} from '../game/gear'
import type { Bonuses } from '../game/modifiers'
import {
  ITEM_BY_ID,
  combatStyleForTags,
  weaponSkill,
  type ArmourType,
  type CombatStyle,
  type GearStats,
  type ItemDef,
  type SkillId,
  type UnlockReq,
} from '../game/skills'
import { accountBandBonuses, enchantOf } from './bands'
import { ensureWornGear } from './gear'
import { consumeItems } from './items'
import { aggregateBonuses, loadProgress, skillLevelOf } from './progress'

// --- combat (Phase 8, docs/DESIGN.md §13.5) ----------------------------------

export interface PlayerCombat {
  /** The combat profession this loadout trains (from the equipped weapon). */
  skill: SkillId
  combatStyle: CombatStyle
  maxHp: number
  power: number
  armour: number
  weaponPower: number
  bodyArmour: number
  stats: GearStats
  stamina: number
  crit: number
  haste: number
  mastery: number
  /** fraction of damage dealt returned as HP (from iron bands/enchants). */
  lifesteal: number
  gearScore: number
  /** Active armour-set bonuses for the current loadout. */
  setBonuses: ActiveSetBonus[]
}

type EquipmentRow = ReturnType<typeof listEquipment>[number]

/** The weapon's trained skill, the worn stats, and the raw power/armour. */
interface Loadout {
  skill: SkillId
  combatStyle: CombatStyle
  stats: GearStats
  totalPower: number
  totalArmour: number
  armourCounts: Partial<Record<ArmourType, number>>
}

/** The player's effective combat level, used to scale monsters. */
export function combatLevel(db: Db, userId: string, levels?: Map<string, number>): number {
  return Math.max(
    skillLevelOf(db, userId, 'attack', levels),
    skillLevelOf(db, userId, 'strength', levels),
    skillLevelOf(db, userId, 'ranged', levels),
    skillLevelOf(db, userId, 'magic', levels),
    skillLevelOf(db, userId, 'defence', levels),
    skillLevelOf(db, userId, 'constitution', levels),
  )
}

/** The active set bonuses for the current loadout (without the full combat maths). */
export function loadoutSetBonuses(db: Db, userId: string): ActiveSetBonus[] {
  ensureWornGear(db, userId)
  return activeSetBonuses(armourCounts(db, userId))
}

function armourCounts(db: Db, userId: string): Partial<Record<ArmourType, number>> {
  const counts: Partial<Record<ArmourType, number>> = {}
  for (const row of listEquipment(db, userId)) {
    const item = ITEM_BY_ID.get(row.itemId)
    if (item?.armourType) counts[item.armourType] = (counts[item.armourType] ?? 0) + 1
  }
  return counts
}

/**
 * The player's combat numbers for their current loadout. The equipped weapon
 * decides the trained skill (sword → Strength, bow → Ranged, staff → Magic), so
 * fights always use what you have — no per-monster choice. Every worn piece
 * contributes its rolled stats, armour and power.
 */
export function loadPlayerCombat(
  db: Db,
  userId: string,
  levels?: Map<string, number>,
): PlayerCombat {
  ensureWornGear(db, userId)
  const b = aggregateBonuses(db, userId, levels)
  const load = loadout(db, userId)
  const setBonuses = activeSetBonuses(load.armourCounts)
  const boosted = applySetBonuses(load.stats, load.totalArmour, load.totalPower, setBonuses)
  return combatNumbers({ db, userId, levels, b, load, setBonuses, boosted })
}

function loadout(db: Db, userId: string): Loadout {
  const eq = listEquipment(db, userId)
  const weapon = eq.find((e) => e.slot === 'mainHand' || e.slot === 'weapon')
  const weaponItem = weapon ? ITEM_BY_ID.get(weapon.itemId) : undefined
  return {
    skill: weaponSkill(weaponItem?.tags),
    combatStyle: combatStyleForTags(weaponItem?.tags),
    ...gearTotals(db, userId, eq),
  }
}

function gearTotals(db: Db, userId: string, eq: EquipmentRow[]) {
  let stats = emptyStats()
  let totalPower = 0
  let totalArmour = 0
  const armourCounts: Partial<Record<ArmourType, number>> = {}
  for (const row of eq) {
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item) continue
    if (item.armourType) armourCounts[item.armourType] = (armourCounts[item.armourType] ?? 0) + 1
    const piece = pieceTotals(db, userId, row, item, stats)
    stats = piece.stats
    totalPower += piece.power
    totalArmour += piece.armour
  }
  return { stats, totalPower, totalArmour, armourCounts }
}

/** One worn piece's contribution, including the enchant's flat stat points. */
function pieceTotals(db: Db, userId: string, row: EquipmentRow, item: ItemDef, running: GearStats) {
  const instance = row.instanceId ? getGearInstance(db, userId, row.instanceId) : undefined
  let stats = addStats(running, instance ? parseStats(instance.statsJson) : statsOf(item))
  const def = instance ? enchantOf(instance) : undefined
  if (def) stats = { ...stats, [def.stat]: stats[def.stat] + def.value }
  return {
    stats,
    power: instance?.power ?? item.power ?? 0,
    armour: instance?.armour ?? item.armour ?? 0,
  }
}

interface Assembly {
  db: Db
  userId: string
  levels?: Map<string, number>
  b: Bonuses
  load: Loadout
  setBonuses: ActiveSetBonus[]
  boosted: { stats: GearStats; armour: number; power: number }
}

function combatNumbers(a: Assembly): PlayerCombat {
  const derived = deriveStats(a.boosted.stats, a.load.skill)
  // Tier bands grant an account-wide passive (§13.5.3), on top of the rolled and
  // enchanted piece stats.
  const band = accountBandBonuses(a.db, a.userId)
  const stamina = Math.round(a.boosted.stats.stamina + band.stamina)
  return {
    skill: a.load.skill,
    combatStyle: a.load.combatStyle,
    armour: a.boosted.armour,
    weaponPower: a.boosted.power,
    bodyArmour: a.boosted.armour,
    gearScore: gearScore(a.boosted.stats, a.boosted.armour, a.boosted.power),
    setBonuses: a.setBonuses,
    ...vitals(a, derived, band, stamina),
    ...passives(a.boosted.stats, derived, band, stamina),
  }
}

/** Max HP and power: the profession level, the worn gear and the passives. */
function vitals(
  a: Assembly,
  derived: ReturnType<typeof deriveStats>,
  band: ReturnType<typeof accountBandBonuses>,
  stamina: number,
) {
  const level = (skill: SkillId) => skillLevelOf(a.db, a.userId, skill, a.levels)
  return {
    maxHp: playerMaxHp(level('constitution'), a.b.hp, a.boosted.armour, stamina),
    power: playerPower(
      level(a.load.skill),
      a.boosted.power,
      a.b.damage,
      derived.primary,
      derived.mastery + band.mastery,
    ),
  }
}

/** The derived stat totals: band passives plus the rounded stamina. */
function passives(
  stats: GearStats,
  derived: ReturnType<typeof deriveStats>,
  band: ReturnType<typeof accountBandBonuses>,
  stamina: number,
) {
  return {
    stats: { ...stats, stamina },
    stamina,
    crit: derived.crit + band.crit,
    haste: derived.haste + band.haste,
    mastery: derived.mastery + band.mastery,
    lifesteal: band.lifesteal,
  }
}

/** Every monster is fightable with whatever gear you have — no per-monster gate. */
export function monsterState(
  _db: Db,
  _userId: string,
  _m: MonsterDef,
): { unlocked: boolean; missing: UnlockReq[]; equipMissing: { slot: string; tag: string } | null } {
  return { unlocked: true, missing: [], equipMissing: null }
}

// --- auto-used consumables ---------------------------------------------------

/**
 * The player's HP right now. HP persists between fights (docs/DESIGN.md §13.5):
 * damage carries over and only food/potions restore it, so re-entering a fight
 * is not a free heal. A player who has never fought starts at full; the value is
 * clamped to their current max HP, which moves with Constitution and armour.
 */
export function currentHp(db: Db, userId: string, maxHp: number): number {
  const stored = getPlayerHp(db, userId)
  if (stored == null) return maxHp
  return Math.max(1, Math.min(stored, maxHp))
}

/** HP a defeat leaves you at — a sliver, so you must eat to recover. */
export const DEFEAT_HP = 1

const DEFAULT_FOOD_THRESHOLD = 0.5

/** Food is auto-eaten when HP falls below this fraction (user setting, %). */
export function foodThreshold(db: Db, userId: string): number {
  const raw = getUserSetting(db, userId, 'foodThreshold')
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 && n <= 100 ? n / 100 : DEFAULT_FOOD_THRESHOLD
}

function bestConsumable(
  db: Db,
  userId: string,
  score: (item: ItemDef) => number | undefined,
): ItemDef | undefined {
  let best: ItemDef | undefined
  let bestScore = -Infinity
  for (const row of listInventory(db, userId)) {
    if (row.count <= 0) continue
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item) continue
    const s = score(item)
    if (s === undefined) continue
    if (s > bestScore) {
      bestScore = s
      best = item
    }
  }
  return best
}

/** The best food in the bank (highest heal). */
export function bestFood(db: Db, userId: string): ItemDef | undefined {
  return bestConsumable(db, userId, (i) => i.heal)
}

/** The best potion in the bank (highest buff). */
export function bestPotion(db: Db, userId: string): ItemDef | undefined {
  return bestConsumable(db, userId, (i) => (i.buff ? i.buff.value : undefined))
}

/** What a fight-start potion did: raise power, raise max HP, or nothing. */
type Drank = { item: string; buff: { kind: 'power' | 'maxHp'; value: number } } | null

interface DrinkResult {
  maxHp: number
  powerBonus: number
  potionId: string | null
  drank: Drank
}

/** Drinks the best buff potion at the start of a fight, returning its effect. */
function drinkBestPotion(db: Db, bus: EventBus, userId: string, maxHp: number): DrinkResult {
  const potion = bestPotion(db, userId)
  if (!potion?.buff) return { maxHp, powerBonus: 0, potionId: null, drank: null }
  consumeItems(db, bus, userId, [{ item: potion.id, count: 1 }])
  const raisedHp =
    potion.buff.kind === 'maxHp' ? Math.round(maxHp * (1 + potion.buff.value)) : maxHp
  return {
    maxHp: raisedHp,
    powerBonus: potion.buff.kind === 'power' ? potion.buff.value : 0,
    potionId: potion.id,
    drank: { item: potion.id, buff: potion.buff },
  }
}

/** The encounter numbers a fresh fight starts with. */
export interface EncounterStart {
  monsterId: string
  monsterHp: number
  monsterMaxHp: number
  monsterDamage: number
  monsterLevel: number
  xpReward: number
  playerHp: number
  playerMaxHp: number
}

export type StartResult =
  | { ok: true; monster: MonsterDef; encounter: EncounterStart; drank: Drank }
  | {
      ok: false
      error: string
      missing?: UnlockReq[]
      equipMissing?: { slot: string; tag: string }
    }

export function startEncounter(
  db: Db,
  bus: EventBus,
  userId: string,
  monsterId: string,
): StartResult {
  const m = MONSTER_BY_ID.get(monsterId)
  if (!m) return { ok: false, error: 'unknown monster' }
  const locked = lockResult(db, userId, m)
  if (locked) return locked
  const pc = loadPlayerCombat(db, userId, loadProgress(db, userId).levels)
  const potion = drinkBestPotion(db, bus, userId, pc.maxHp)
  // HP carries between fights: resume from what's left, clamped to this fight's
  // max HP (which a restore potion may have raised).
  const startHp = currentHp(db, userId, potion.maxHp)
  upsertEncounter(db, userId, startRow(monsterId, m, potion, startHp))
  return startOk(monsterId, m, potion, startHp)
}

function startOk(
  monsterId: string,
  m: MonsterDef,
  potion: DrinkResult,
  startHp: number,
): StartResult {
  return {
    ok: true,
    monster: m,
    encounter: startView(monsterId, m, potion, startHp),
    drank: potion.drank,
  }
}

/** The refusal when the monster is locked for this player, else undefined. */
function lockResult(db: Db, userId: string, m: MonsterDef): StartResult | undefined {
  const state = monsterState(db, userId, m)
  if (state.unlocked) return undefined
  return {
    ok: false,
    error: 'locked',
    missing: state.missing,
    equipMissing: state.equipMissing ?? undefined,
  }
}

// Monsters are **fixed** (docs §13.5): their numbers never move, so the buffs a
// player stacks read as power, not as a modifier that cancels itself out.
function startRow(monsterId: string, m: MonsterDef, potion: DrinkResult, startHp: number) {
  return {
    monsterId,
    monsterHp: m.hp,
    playerHp: startHp,
    playerMaxHp: potion.maxHp,
    monsterMaxHp: m.hp,
    monsterDamage: m.damage,
    monsterLevel: m.level,
    xpReward: m.xp,
    powerBonus: potion.powerBonus,
    potionId: potion.potionId,
    foodEaten: 0,
    totalDamage: 0,
    xpEarned: 0,
  }
}

function startView(
  monsterId: string,
  m: MonsterDef,
  potion: DrinkResult,
  startHp: number,
): EncounterStart {
  return {
    monsterId,
    monsterHp: m.hp,
    monsterMaxHp: m.hp,
    monsterDamage: m.damage,
    monsterLevel: m.level,
    xpReward: m.xp,
    playerHp: startHp,
    playerMaxHp: potion.maxHp,
  }
}
