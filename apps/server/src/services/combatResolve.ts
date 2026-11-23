/** Resolving one drill inside a combat encounter (docs/DESIGN.md §13.5). */

import { clearEncounter, getEncounter, setPlayerHp, upsertEncounter } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { MONSTER_BY_ID, incomingDamage, rollDrops } from '../game/combat'
import { type Cost, type SkillId } from '../game/skills'
import { DEFEAT_HP, bestFood, foodThreshold, loadPlayerCombat, type PlayerCombat } from './combat'
import { consumeItems, grantFixedItems } from './items'
import { awardXp } from './overview'
import { awardActionXp, loadProgress, primaryActionId, type ProgressCtx } from './progress'

export interface HitOutcome {
  correct: boolean
  /** the combat profession the equipped weapon trains */
  skill: PlayerCombat['skill']
  damage: number
  /** True when the hit rolled a critical strike. */
  crit: boolean
  /** True when Haste granted a second strike. */
  haste: boolean
  monsterHp: number
  monsterMaxHp: number
  monsterDamage: number
  monsterLevel: number
  playerDamage: number
  playerHp: number
  playerMaxHp: number
  outcome: 'ongoing' | 'won' | 'lost'
  drops: Cost[]
  xp: number
  /** Defence XP gained from weathering the monster's blow. */
  defenceXp: number
  /** Constitution XP gained from weathering the monster's blow. */
  constitutionXp: number
  ate: { item: string; heal: number; playerHp: number } | null
  talentUnlocked: number | null
}

/** The live encounter plus the fallback numbers its monster definition fills in. */
interface EncounterContext {
  monster: NonNullable<ReturnType<typeof MONSTER_BY_ID.get>>
  enc: EncounterRow
  pc: PlayerCombat
  maxHp: number
  monsterMaxHp: number
  monsterDamage: number
  monsterLevel: number
  xpReward: number
}

type EncounterRow = NonNullable<ReturnType<typeof getEncounter>>

/** Builds the fight context from an already-read encounter row. */
function encounterContext(
  db: Db,
  userId: string,
  enc: EncounterRow,
  levels: Map<string, number>,
): EncounterContext | null {
  const monster = MONSTER_BY_ID.get(enc.monsterId)
  if (!monster) {
    clearEncounter(db, userId)
    return null
  }
  const pc = loadPlayerCombat(db, userId, levels)
  return {
    monster,
    enc,
    pc,
    maxHp: enc.playerMaxHp || pc.maxHp,
    monsterMaxHp: enc.monsterMaxHp || monster.hp,
    monsterDamage: enc.monsterDamage || monster.damage,
    monsterLevel: enc.monsterLevel || monster.level,
    xpReward: enc.xpReward || monster.xp,
  }
}

/** Auto-eat the best food once, before the exchange, when HP is below the threshold. */
function autoEat(
  db: Db,
  bus: EventBus,
  userId: string,
  state: { playerHp: number; maxHp: number; foodEaten: number },
): { playerHp: number; foodEaten: number; ate: HitOutcome['ate'] } {
  const { maxHp, foodEaten } = state
  if (state.playerHp <= 0 || state.playerHp / maxHp >= foodThreshold(db, userId)) {
    return { playerHp: state.playerHp, foodEaten, ate: null }
  }
  const food = bestFood(db, userId)
  if (!food?.heal) return { playerHp: state.playerHp, foodEaten, ate: null }
  consumeItems(db, bus, userId, [{ item: food.id, count: 1 }])
  const healed = Math.min(maxHp, state.playerHp + food.heal)
  return {
    playerHp: healed,
    foodEaten: foodEaten + 1,
    ate: { item: food.id, heal: food.heal, playerHp: healed },
  }
}

/** The player's strike: damage, crit/haste, the monster's new HP and the Life-steal heal. */
function playerStrike(
  pc: PlayerCombat,
  ctx: EncounterContext,
  playerHp: number,
  rand: () => number,
): {
  damage: number
  crit: boolean
  haste: boolean
  monsterHp: number
  playerHp: number
  xp: number
} {
  const crit = pc.crit > 0 && rand() < pc.crit
  const haste = pc.haste > 0 && rand() < pc.haste
  const multiplier = (crit ? 1.75 : 1) * (1 + pc.mastery) * (haste ? 1.5 : 1)
  const damage = Math.max(1, Math.round(pc.power * (1 + ctx.enc.powerBonus) * multiplier))
  // Iron bands/enchants return a slice of the damage dealt as HP.
  const heal = pc.lifesteal > 0 ? Math.round(damage * pc.lifesteal) : 0
  return {
    damage,
    crit,
    haste,
    monsterHp: Math.max(0, ctx.enc.monsterHp - damage),
    playerHp: heal > 0 ? Math.min(ctx.maxHp, playerHp + heal) : playerHp,
    xp: Math.max(1, Math.round(ctx.xpReward / 4)),
  }
}

/**
 * The monster always swings — whether you strike it, miss, or run out of time. A
 * correct answer only adds your own hit on top; armour reduces both the damage and
 * the Defence/Constitution training it gives.
 */
function monsterStrike(
  pc: PlayerCombat,
  playerHp: number,
  monsterDamage: number,
): { playerDamage: number; playerHp: number } {
  const playerDamage = incomingDamage(monsterDamage, pc.armour)
  return { playerDamage, playerHp: Math.max(0, playerHp - playerDamage) }
}

interface Exchange {
  monsterHp: number
  playerHp: number
  foodEaten: number
  damage: number
  xp: number
  drops: Cost[]
  outcome: HitOutcome['outcome']
}

/** Writes the surviving HP + win rewards, then clears or persists the encounter. */
function settleExchange(
  db: Db,
  bus: EventBus,
  userId: string,
  ctx: EncounterContext,
  state: Exchange,
): void {
  // HP persists between fights: a defeat leaves you at a sliver, not a free heal.
  setPlayerHp(
    db,
    userId,
    state.outcome === 'lost' ? DEFEAT_HP : Math.max(DEFEAT_HP, state.playerHp),
  )
  if (state.outcome === 'won') {
    grantFixedItems(db, bus, userId, state.drops)
    awardXp(db, bus, userId, ctx.xpReward, 'combat', ctx.monster.id)
  }
  if (state.outcome !== 'ongoing') {
    bus.emit('combat.ended', { userId, monsterId: ctx.monster.id, outcome: state.outcome })
    clearEncounter(db, userId)
    return
  }
  upsertEncounter(db, userId, {
    monsterId: ctx.monster.id,
    monsterHp: state.monsterHp,
    playerHp: state.playerHp,
    playerMaxHp: ctx.maxHp,
    monsterMaxHp: ctx.monsterMaxHp,
    monsterDamage: ctx.monsterDamage,
    monsterLevel: ctx.monsterLevel,
    xpReward: ctx.xpReward,
    powerBonus: ctx.enc.powerBonus,
    potionId: ctx.enc.potionId,
    foodEaten: state.foodEaten,
    totalDamage: ctx.enc.totalDamage + state.damage,
    xpEarned: ctx.enc.xpEarned + state.xp,
  })
}

/** Awards the exchange's XP and returns the profession milestone it unlocked, if any. */
function awardExchange(
  db: Db,
  bus: EventBus,
  userId: string,
  parts: { skill: SkillId; xp: number; defenceXp: number; constitutionXp: number },
  progress: ProgressCtx,
): number | null {
  const awards = [
    { actionId: primaryActionId(parts.skill), amount: parts.xp, ctx: progress },
    { actionId: primaryActionId('defence'), amount: parts.defenceXp, ctx: progress },
    { actionId: primaryActionId('constitution'), amount: parts.constitutionXp, ctx: progress },
  ]
    .filter((a) => a.amount > 0)
    .map((a) => awardActionXp(db, bus, userId, a))
  return awards.find((a) => a?.talentUnlocked)?.talentUnlocked ?? null
}

/** Resolves one drill inside an active encounter. */
export function combatResolve(
  db: Db,
  bus: EventBus,
  userId: string,
  correct: boolean,
  rand: () => number = Math.random,
): HitOutcome | null {
  const enc = getEncounter(db, userId)
  if (!enc) return null
  const progress = loadProgress(db, userId)
  const ctx = encounterContext(db, userId, enc, progress.levels)
  if (!ctx) return null
  const { pc } = ctx

  const eaten = autoEat(db, bus, userId, {
    playerHp: ctx.enc.playerHp,
    maxHp: ctx.maxHp,
    foodEaten: ctx.enc.foodEaten,
  })
  let playerHp = eaten.playerHp
  let monsterHp = ctx.enc.monsterHp
  let xp = 0
  let damage = 0
  let crit = false
  let haste = false

  if (correct) {
    ;({ damage, crit, haste, monsterHp, playerHp, xp } = playerStrike(pc, ctx, playerHp, rand))
    bus.emit('combat.hit', { userId, monsterId: ctx.monster.id, damage, monsterHp, crit, haste })
  }

  const blow = monsterStrike(pc, playerHp, ctx.monsterDamage)
  playerHp = blow.playerHp
  const defenceXp = Math.max(1, blow.playerDamage)
  const constitutionXp = Math.max(1, blow.playerDamage)

  const drops: Cost[] = []
  let outcome: HitOutcome['outcome'] = 'ongoing'
  if (monsterHp <= 0) {
    outcome = 'won'
    xp += ctx.xpReward
    drops.push(...rollDrops(ctx.monster.drops, progress.bonuses.drop, rand))
  } else if (playerHp <= 0) {
    outcome = 'lost'
  }

  const parts = { skill: pc.skill, xp, defenceXp, constitutionXp }
  const talentUnlocked = awardExchange(db, bus, userId, parts, progress)

  settleExchange(db, bus, userId, ctx, {
    monsterHp,
    playerHp,
    foodEaten: eaten.foodEaten,
    damage,
    xp,
    drops,
    outcome,
  })

  return {
    correct,
    skill: pc.skill,
    damage,
    crit,
    haste,
    monsterHp,
    monsterMaxHp: ctx.monsterMaxHp,
    monsterDamage: ctx.monsterDamage,
    monsterLevel: ctx.monsterLevel,
    playerDamage: blow.playerDamage,
    playerHp,
    playerMaxHp: ctx.maxHp,
    outcome,
    drops,
    xp,
    defenceXp,
    constitutionXp,
    ate: eaten.ate,
    talentUnlocked,
  }
}
