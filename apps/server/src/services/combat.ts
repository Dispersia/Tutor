import type { UserId } from '../ids'
import {
  getEncounter,
  getGearInstance,
  getPlayerHp,
  getUserSetting,
  listEquipment,
  listInventory,
  upsertEncounter,
} from '../db/repo'
import type { Db } from '../db/client'
import { atomic } from '../db/repo/helpers'
import type { EventBus } from '../events'
import {
  clampFoodThreshold,
  FOOD_THRESHOLD_DEFAULT,
  MONSTER_BY_ID,
  playerMaxHp,
  playerPower,
  type MonsterDef,
} from '../game/combat'
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
  canonicalSlot,
  combatStyleForTags,
  weaponSkill,
  type ArmourType,
  type CombatStyle,
  type GearStats,
  type ItemDef,
  type SkillId,
} from '../game/skills'
import { accountBandBonuses, enchantOf } from './bands'
import { consumeItems } from './items'
import { aggregateBonuses, loadProgress, skillLevelOf } from './progress'

export interface PlayerCombat {
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
  lifesteal: number
  gearScore: number
  setBonuses: ActiveSetBonus[]
}

type EquipmentRow = ReturnType<typeof listEquipment>[number]

interface Loadout {
  skill: SkillId
  combatStyle: CombatStyle
  stats: GearStats
  totalPower: number
  totalArmour: number
  armourCounts: Partial<Record<ArmourType, number>>
}

export function combatLevel(db: Db, userId: UserId, levels?: Map<string, number>): number {
  return Math.max(
    skillLevelOf(db, userId, 'attack', levels),
    skillLevelOf(db, userId, 'strength', levels),
    skillLevelOf(db, userId, 'ranged', levels),
    skillLevelOf(db, userId, 'magic', levels),
  )
}

export function loadoutSetBonuses(db: Db, userId: UserId): ActiveSetBonus[] {
  return activeSetBonuses(loadout(db, userId).armourCounts)
}

export function loadPlayerCombat(
  db: Db,
  userId: UserId,
  levels?: Map<string, number>,
): PlayerCombat {
  const b = aggregateBonuses(db, userId, levels)
  const load = loadout(db, userId)
  const setBonuses = activeSetBonuses(load.armourCounts)
  const boosted = applySetBonuses(load.stats, load.totalArmour, load.totalPower, setBonuses)
  return combatNumbers({ db, userId, levels, b, load, setBonuses, boosted })
}

function loadout(db: Db, userId: UserId): Loadout {
  const eq = listEquipment(db, userId)
  const weapon = eq.find((e) => canonicalSlot(e.slot) === 'mainHand')
  const weaponItem = weapon ? ITEM_BY_ID.get(weapon.itemId) : undefined
  return {
    skill: weaponSkill(weaponItem?.tags),
    combatStyle: combatStyleForTags(weaponItem?.tags),
    ...gearTotals(db, userId, eq),
  }
}

function gearTotals(db: Db, userId: UserId, eq: EquipmentRow[]) {
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

function pieceTotals(db: Db, userId: UserId, row: EquipmentRow, item: ItemDef, running: GearStats) {
  const instance = row.instanceId ? getGearInstance(db, userId, row.instanceId) : undefined
  let stats = addStats(running, instance ? parseStats(instance.statsJson) : statsOf(item))
  const def = instance ? enchantOf(instance) : undefined
  if (def) stats = { ...stats, [def.stat]: stats[def.stat] + def.value }
  return {
    stats,
    power: numberOr(instance?.power, item.power, 0),
    armour: numberOr(instance?.armour, item.armour, 0),
  }
}

function numberOr(
  first: number | null | undefined,
  second: number | null | undefined,
  fallback: number,
): number {
  return first || second || fallback
}

interface Assembly {
  db: Db
  userId: UserId
  levels?: Map<string, number>
  b: Bonuses
  load: Loadout
  setBonuses: ActiveSetBonus[]
  boosted: { stats: GearStats; armour: number; power: number }
}

function combatNumbers(a: Assembly): PlayerCombat {
  const derived = deriveStats(a.boosted.stats, a.load.skill)
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

function vitals(
  a: Assembly,
  derived: ReturnType<typeof deriveStats>,
  band: ReturnType<typeof accountBandBonuses>,
  stamina: number,
) {
  const level = (skill: SkillId) => skillLevelOf(a.db, a.userId, skill, a.levels)
  return {
    maxHp: playerMaxHp(a.b.hp, a.boosted.armour, stamina),
    power: playerPower(
      level(a.load.skill),
      a.boosted.power,
      a.b.damage,
      derived.primary,
      derived.mastery + band.mastery,
    ),
  }
}

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

export const DEFEAT_HP = 1

export function currentHp(db: Db, userId: UserId, maxHp: number): number {
  const stored = getPlayerHp(db, userId)
  if (stored == null) return maxHp
  return Math.max(DEFEAT_HP, Math.min(stored, maxHp))
}

export function foodThreshold(db: Db, userId: UserId): number {
  const raw = getUserSetting(db, userId, 'foodThreshold')
  const n = raw ? Number(raw) : NaN
  const percent = Number.isFinite(n) ? clampFoodThreshold(n) : FOOD_THRESHOLD_DEFAULT
  return percent / 100
}

function bestConsumable(
  db: Db,
  userId: UserId,
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

export function bestFood(db: Db, userId: UserId): ItemDef | undefined {
  return bestConsumable(db, userId, (i) => i.heal)
}

function bestPotion(db: Db, userId: UserId): ItemDef | undefined {
  return bestConsumable(db, userId, (i) => (i.buff ? i.buff.value : undefined))
}

type Drank = { item: string; buff: { kind: 'power' | 'maxHp'; value: number } } | null

interface DrinkResult {
  maxHp: number
  powerBonus: number
  potionId: string | null
  drank: Drank
}

function drinkBestPotion(db: Db, bus: EventBus, userId: UserId, maxHp: number): DrinkResult {
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

interface EncounterStart {
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
  | { ok: false; error: string }

function startEncounterTx(db: Db, bus: EventBus, userId: UserId, monsterId: string): StartResult {
  const m = MONSTER_BY_ID.get(monsterId)
  if (!m) return { ok: false, error: 'unknown monster' }
  if (getEncounter(db, userId))
    return { ok: false, error: 'finish or flee the current fight first' }
  const pc = loadPlayerCombat(db, userId, loadProgress(db, userId).levels)
  const potion = drinkBestPotion(db, bus, userId, pc.maxHp)
  const startHp = currentHp(db, userId, potion.maxHp)
  upsertEncounter(db, userId, startRow(monsterId, m, potion, startHp))
  return startOk(monsterId, m, potion, startHp)
}

export const startEncounter = atomic(startEncounterTx)

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
