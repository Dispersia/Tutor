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
  return { monster, enc, pc, ...fallbackNumbers(enc, monster, pc.maxHp) }
}

/** The encounter's stored numbers, with the monster definition filling gaps. */
function fallbackNumbers(
  enc: EncounterRow,
  monster: NonNullable<ReturnType<typeof MONSTER_BY_ID.get>>,
  playerMaxHp: number,
) {
  return {
    maxHp: enc.playerMaxHp || playerMaxHp,
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
interface StrikeHit {
  damage: number
  crit: boolean
  haste: boolean
  monsterHp: number
  playerHp: number
  xp: number
}

function playerStrike(
  pc: PlayerCombat,
  ctx: EncounterContext,
  playerHp: number,
  rand: () => number,
): StrikeHit {
  const crit = pc.crit > 0 && rand() < pc.crit
  const haste = pc.haste > 0 && rand() < pc.haste
  const damage = strikeDamage(pc, ctx, crit, haste)
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

/** The hit's damage: mastery scaling, a crit multiplier and a haste extra strike. */
function strikeDamage(
  pc: PlayerCombat,
  ctx: EncounterContext,
  crit: boolean,
  haste: boolean,
): number {
  const multiplier = (crit ? 1.75 : 1) * (1 + pc.mastery) * (haste ? 1.5 : 1)
  return Math.max(1, Math.round(pc.power * (1 + ctx.enc.powerBonus) * multiplier))
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

interface ExchangeState {
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
  state: ExchangeState,
): void {
  // HP persists between fights: a defeat leaves you at a sliver, not a free heal.
  setPlayerHp(
    db,
    userId,
    state.outcome === 'lost' ? DEFEAT_HP : Math.max(DEFEAT_HP, state.playerHp),
  )
  if (state.outcome === 'won') awardWin(db, bus, userId, ctx, state.drops)
  if (state.outcome !== 'ongoing') return endFight(db, bus, userId, ctx.monster.id, state.outcome)
  upsertEncounter(db, userId, ongoingRow(ctx, state))
}

function awardWin(
  db: Db,
  bus: EventBus,
  userId: string,
  ctx: EncounterContext,
  drops: Cost[],
): void {
  grantFixedItems(db, bus, userId, drops)
  awardXp(db, bus, userId, ctx.xpReward, 'combat', ctx.monster.id)
}

function endFight(
  db: Db,
  bus: EventBus,
  userId: string,
  monsterId: string,
  outcome: 'won' | 'lost',
): void {
  bus.emit('combat.ended', { userId, monsterId, outcome })
  clearEncounter(db, userId)
}

/** The encounter row to persist while the fight continues. */
function ongoingRow(ctx: EncounterContext, state: ExchangeState) {
  return {
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
  }
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

/** One exchange's rolled numbers, before the outcome is decided. */
interface Exchange {
  monsterHp: number
  playerHp: number
  damage: number
  crit: boolean
  haste: boolean
  xp: number
  playerDamage: number
}

interface Decided {
  outcome: HitOutcome['outcome']
  xp: number
  drops: Cost[]
}

interface OutcomeParts extends Decided {
  defenceXp: number
  constitutionXp: number
  talentUnlocked: number | null
}

/** Everything resolving one drill needs, already loaded. */
interface Resolve {
  db: Db
  bus: EventBus
  userId: string
  ctx: EncounterContext
  progress: ProgressCtx
  correct: boolean
  eaten: ReturnType<typeof autoEat>
  rand: () => number
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
  const eaten = autoEat(db, bus, userId, {
    playerHp: enc.playerHp,
    maxHp: ctx.maxHp,
    foodEaten: enc.foodEaten,
  })
  return runEncounter({ db, bus, userId, ctx, progress, correct, eaten, rand })
}

function runEncounter(req: Resolve): HitOutcome {
  const { ctx, progress, correct, eaten, rand } = req
  const ex = strikeExchange(ctx, correct, eaten.playerHp, rand)
  if (correct) emitHit(req, ex)
  const decided = decideOutcome(ctx, progress, ex, rand)
  const awarded = awardStrike(req, ex, decided)
  settleExchange(req.db, req.bus, req.userId, ctx, {
    monsterHp: ex.monsterHp,
    playerHp: ex.playerHp,
    foodEaten: eaten.foodEaten,
    damage: ex.damage,
    xp: decided.xp,
    drops: decided.drops,
    outcome: decided.outcome,
  })
  return hitOutcome({ ctx, correct, ate: eaten.ate, ex, p: awarded })
}

function emitHit(req: Resolve, ex: Exchange): void {
  req.bus.emit('combat.hit', {
    userId: req.userId,
    monsterId: req.ctx.monster.id,
    damage: ex.damage,
    monsterHp: ex.monsterHp,
    crit: ex.crit,
    haste: ex.haste,
  })
}

/** The player's strike (when correct) and the monster's always-on swing. */
function strikeExchange(
  ctx: EncounterContext,
  correct: boolean,
  startHp: number,
  rand: () => number,
): Exchange {
  const hit = correct ? playerStrike(ctx.pc, ctx, startHp, rand) : undefined
  const blow = monsterStrike(ctx.pc, hit?.playerHp ?? startHp, ctx.monsterDamage)
  return {
    monsterHp: hit?.monsterHp ?? ctx.enc.monsterHp,
    playerHp: blow.playerHp,
    damage: hit?.damage ?? 0,
    crit: hit?.crit ?? false,
    haste: hit?.haste ?? false,
    xp: hit?.xp ?? 0,
    playerDamage: blow.playerDamage,
  }
}

function decideOutcome(
  ctx: EncounterContext,
  progress: ProgressCtx,
  ex: Exchange,
  rand: () => number,
): Decided {
  if (ex.monsterHp <= 0) {
    const drops = rollDrops(ctx.monster.drops, progress.bonuses.drop, rand)
    return { outcome: 'won', xp: ex.xp + ctx.xpReward, drops }
  }
  if (ex.playerHp <= 0) return { outcome: 'lost', xp: ex.xp, drops: [] }
  return { outcome: 'ongoing', xp: ex.xp, drops: [] }
}

/** The exchange's XP, plus the profession milestone it unlocked, if any. */
function awardStrike(req: Resolve, ex: Exchange, decided: Decided): OutcomeParts {
  const defenceXp = Math.max(1, ex.playerDamage)
  const talentUnlocked = awardExchange(
    req.db,
    req.bus,
    req.userId,
    { skill: req.ctx.pc.skill, xp: decided.xp, defenceXp, constitutionXp: defenceXp },
    req.progress,
  )
  return { ...decided, defenceXp, constitutionXp: defenceXp, talentUnlocked }
}

interface HitParts {
  ctx: EncounterContext
  correct: boolean
  ate: HitOutcome['ate']
  ex: Exchange
  p: OutcomeParts
}

function hitOutcome(h: HitParts): HitOutcome {
  return {
    correct: h.correct,
    skill: h.ctx.pc.skill,
    ...strikeView(h.ex),
    ...encounterNumbers(h.ctx),
    ...h.p,
    ate: h.ate,
  }
}

function strikeView(ex: Exchange) {
  return {
    damage: ex.damage,
    crit: ex.crit,
    haste: ex.haste,
    monsterHp: ex.monsterHp,
    playerDamage: ex.playerDamage,
    playerHp: ex.playerHp,
  }
}

function encounterNumbers(ctx: EncounterContext) {
  return {
    monsterMaxHp: ctx.monsterMaxHp,
    monsterDamage: ctx.monsterDamage,
    monsterLevel: ctx.monsterLevel,
    playerMaxHp: ctx.maxHp,
  }
}
