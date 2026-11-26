import type { UserId } from '../ids'
import { clearEncounter, getEncounter, setPlayerHp, upsertEncounter } from '../db/repo'
import type { Db } from '../db/client'
import { atomic } from '../db/repo/helpers'
import type { EventBus } from '../events'
import { MONSTER_BY_ID, incomingDamage, rollDrops } from '../game/combat'
import { type Cost, type SkillId } from '../game/skills'
import { DEFEAT_HP, bestFood, foodThreshold, loadPlayerCombat, type PlayerCombat } from './combat'
import { consumeItems, grantFixedItems } from './items'
import { awardXp } from './overview'
import { awardActionXp, loadProgress, primaryActionId, type ProgressCtx } from './progress'

export interface HitOutcome {
  correct: boolean
  skill: PlayerCombat['skill']
  damage: number
  crit: boolean
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
  ate: { item: string; heal: number; playerHp: number } | null
  talentUnlocked: number | null
}

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

function encounterContext(
  db: Db,
  userId: UserId,
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

function autoEat(
  db: Db,
  bus: EventBus,
  userId: UserId,
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

function strikeDamage(
  pc: PlayerCombat,
  ctx: EncounterContext,
  crit: boolean,
  haste: boolean,
): number {
  const multiplier = (crit ? 1.75 : 1) * (haste ? 1.5 : 1)
  return Math.max(1, Math.round(pc.power * (1 + ctx.enc.powerBonus) * multiplier))
}

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

function settleExchange(
  db: Db,
  bus: EventBus,
  userId: UserId,
  ctx: EncounterContext,
  state: ExchangeState,
): void {
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
  userId: UserId,
  ctx: EncounterContext,
  drops: Cost[],
): void {
  grantFixedItems(db, bus, userId, drops)
  awardXp(db, bus, userId, { amount: ctx.xpReward, reason: 'combat', sourceId: ctx.monster.id })
}

function endFight(
  db: Db,
  bus: EventBus,
  userId: UserId,
  monsterId: string,
  outcome: 'won' | 'lost',
): void {
  bus.emit('combat.ended', { userId, monsterId, outcome })
  clearEncounter(db, userId)
}

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

function awardExchange(
  db: Db,
  bus: EventBus,
  userId: UserId,
  parts: { skill: SkillId; xp: number },
  progress: ProgressCtx,
): number | null {
  if (parts.xp <= 0) return null
  const award = awardActionXp(db, bus, userId, {
    actionId: primaryActionId(parts.skill),
    amount: parts.xp,
    ctx: progress,
  })
  return award.talentUnlocked
}

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
  talentUnlocked: number | null
}

interface Resolve {
  db: Db
  bus: EventBus
  userId: UserId
  ctx: EncounterContext
  progress: ProgressCtx
  correct: boolean
  eaten: ReturnType<typeof autoEat>
  rand: () => number
}

function combatResolveTx(
  db: Db,
  bus: EventBus,
  userId: UserId,
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

export const combatResolve = atomic(combatResolveTx)

function runEncounter(req: Resolve): HitOutcome {
  const { ctx, progress, correct, eaten, rand } = req
  const ex = strikeExchange(ctx, correct, eaten.playerHp, rand)
  if (correct) emitHit(req, ex)
  const decided = decideOutcome(ctx, progress, ex, rand)
  const awarded = awardStrike(req, decided)
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

function swingBack(ctx: EncounterContext, hit: StrikeHit | undefined, playerHp: number) {
  if (hit && hit.monsterHp <= 0) return { playerDamage: 0, playerHp }
  return monsterStrike(ctx.pc, playerHp, ctx.monsterDamage)
}

function strikeExchange(
  ctx: EncounterContext,
  correct: boolean,
  startHp: number,
  rand: () => number,
): Exchange {
  const hit = correct ? playerStrike(ctx.pc, ctx, startHp, rand) : undefined
  const blow = swingBack(ctx, hit, hit?.playerHp ?? startHp)
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

function awardStrike(req: Resolve, decided: Decided): OutcomeParts {
  const talentUnlocked = awardExchange(
    req.db,
    req.bus,
    req.userId,
    { skill: req.ctx.pc.skill, xp: decided.xp },
    req.progress,
  )
  return { ...decided, talentUnlocked }
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
