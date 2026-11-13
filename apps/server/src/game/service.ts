import type { Db } from '../db/client'
import {
  addItems,
  addTalent,
  addXpEvent,
  clearEncounter,
  completeLesson,
  getEncounter,
  getItemCount,
  getSkillXp,
  getSrs,
  getStats,
  getUserSetting,
  hasTalent,
  listCards,
  listDecks,
  listEquipment,
  listInventory,
  listLessonProgress,
  listSkillProgress,
  listSrs,
  listTalents,
  setEquipment,
  setSkillXp,
  sumXp,
  upsertEncounter,
  upsertSrs,
  upsertStats,
  xpEventsFor,
} from '../db/repo'
import type { EventBus } from '../events'
import { seedStarterDecks } from '../seed/service'
import { buildLessons } from './curriculum'
import {
  NEW_STATE,
  countDue,
  countNew,
  isLearned,
  ratingFromScore,
  schedule,
  type FsrsState,
  type Rating,
} from './srs'
import {
  MONSTER_BY_ID,
  incomingDamage,
  playerMaxHp,
  playerPower,
  rollDrops,
  type MonsterDef,
} from './combat'
import { levelInfo } from './levels'
import { computeBonuses, applyYield, type Bonuses } from './modifiers'
import {
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  type ActionDef,
  type Cost,
  type ItemDef,
  type SkillId,
  type UnlockReq,
  missingMaterials,
  missingUnlocks,
  skillLevelInfo,
} from './skills'
import {
  type TalentDef,
  majorFor,
  majorMilestones,
  minorMilestones,
  minorOptions,
  parseTalentId,
  resolveTalents,
} from './talents'

// --- global XP, streak, summary ---------------------------------------------

/** UTC calendar day as YYYY-MM-DD (the streak granularity — UTC only). */
export function todayDay(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function activeDays(db: Db, userId: string): string[] {
  const set = new Set(xpEventsFor(db, userId).map((r) => todayDay(r.createdAt)))
  return [...set].sort().reverse()
}

export function dailyXp(db: Db, userId: string, day: string): number {
  return xpEventsFor(db, userId)
    .filter((r) => todayDay(r.createdAt) === day)
    .reduce((n, r) => n + r.amount, 0)
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

export function streakFromDays(days: string[], today: string = todayDay()): number {
  if (days.length === 0) return 0
  const set = new Set(days)
  let start = today
  if (!set.has(start)) {
    const yesterday = shiftDay(today, -1)
    if (!set.has(yesterday)) return 0
    start = yesterday
  }
  let n = 0
  let cur = start
  while (set.has(cur)) {
    n++
    cur = shiftDay(cur, -1)
  }
  return n
}

export function awardXp(
  db: Db,
  bus: EventBus,
  userId: string,
  amount: number,
  reason: string,
  sourceId?: string,
): { total: number; level: number; leveledUp: boolean } {
  const before = getStats(db, userId).level
  const bonus = aggregateBonuses(db, userId).globalXp
  const gained = Math.max(0, Math.round(amount * (1 + bonus)))
  addXpEvent(db, userId, gained, reason, sourceId)
  const total = sumXp(db, userId)
  const info = levelInfo(total)
  upsertStats(db, userId, { xpTotal: total, level: info.level })
  bus.emit('xp.awarded', { userId, amount: gained, reason, total })
  const leveledUp = info.level > before
  if (leveledUp) bus.emit('level.up', { userId, level: info.level })
  return { total, level: info.level, leveledUp }
}

export function recordActivity(db: Db, bus: EventBus, userId: string): number {
  const days = activeDays(db, userId)
  const streak = streakFromDays(days)
  upsertStats(db, userId, { streakDays: streak, lastActiveDay: days[0] ?? todayDay() })
  bus.emit('streak.updated', { userId, days: streak })
  return streak
}

export interface GameSummary {
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
}

export function summary(db: Db, userId: string): GameSummary {
  const s = getStats(db, userId)
  const info = levelInfo(s.xpTotal)
  const today = todayDay()
  const daily = dailyXp(db, userId, today)
  const goal = s.dailyGoal || 50
  return {
    xp: s.xpTotal,
    level: info.level,
    intoLevel: info.intoLevel,
    forNext: info.forNext,
    progress: info.progress,
    streak: s.streakDays,
    dailyGoal: goal,
    dailyXp: daily,
    goalPct: Math.min(1, daily / goal),
    todayActive: s.lastActiveDay === today,
  }
}

export function rebuildStats(db: Db, userId: string): GameSummary {
  const total = sumXp(db, userId)
  const days = activeDays(db, userId)
  upsertStats(db, userId, {
    xpTotal: total,
    level: levelInfo(total).level,
    streakDays: streakFromDays(days),
    lastActiveDay: days[0] ?? null,
  })
  return summary(db, userId)
}

// --- professions: bonuses ----------------------------------------------------

export function skillLevelOf(db: Db, userId: string, skillId: SkillId): number {
  return skillLevelInfo(getSkillXp(db, userId, skillId)).level
}

export function aggregateBonuses(db: Db, userId: string): Bonuses {
  const levels = new Map<SkillId, number>(
    SKILLS.map((s) => [s.id, skillLevelInfo(getSkillXp(db, userId, s.id)).level]),
  )
  return computeBonuses(levels, resolveTalents(listTalents(db, userId)))
}

// --- professions: XP + talents ----------------------------------------------

export interface SkillAward {
  skillId: string
  xp: number
  level: number
  leveledUp: boolean
  gained: number
  grantedTalents: TalentDef[]
}

/** Grants the major talents for every 10-level milestone newly reached. */
function grantMajors(
  db: Db,
  bus: EventBus,
  userId: string,
  skillId: SkillId,
  level: number,
): TalentDef[] {
  const granted: TalentDef[] = []
  for (const milestone of majorMilestones(level)) {
    const talent = majorFor(skillId, milestone)
    if (hasTalent(db, userId, talent.id)) continue
    addTalent(db, userId, {
      talentId: talent.id,
      skillId,
      tier: 'major',
      milestone,
    })
    granted.push(talent)
    bus.emit('talent.granted', {
      userId,
      talentId: talent.id,
      skillId,
      tier: 'major',
      milestone,
    })
  }
  return granted
}

export function awardSkillXp(
  db: Db,
  bus: EventBus,
  userId: string,
  skillId: SkillId,
  amount: number,
): SkillAward {
  const beforeXp = getSkillXp(db, userId, skillId)
  const bonus = aggregateBonuses(db, userId)
  const gained = Math.max(0, Math.round(amount * (1 + bonus.xp(skillId) + bonus.globalXp)))
  const xp = beforeXp + gained
  const info = skillLevelInfo(xp)
  setSkillXp(db, userId, skillId, xp, info.level)
  bus.emit('skill.xp', { userId, skillId, amount: gained, xp, level: info.level })

  const leveledUp = info.level > skillLevelInfo(beforeXp).level
  let grantedTalents: TalentDef[] = []
  if (leveledUp) {
    bus.emit('skill.level.up', { userId, skillId, level: info.level })
    grantedTalents = grantMajors(db, bus, userId, skillId, info.level)
  }
  return { skillId, xp, level: info.level, leveledUp, gained, grantedTalents }
}

/** Chooses a minor talent offered at the current 5-level milestone. */
export function chooseTalent(
  db: Db,
  bus: EventBus,
  userId: string,
  talentId: string,
): { ok: boolean; error?: string; talent?: TalentDef } {
  const parsed = parseTalentId(talentId)
  if (!parsed || parsed.tier !== 'minor') return { ok: false, error: 'not a minor talent' }
  const level = skillLevelOf(db, userId, parsed.skillId)
  const ownedMinor = listTalents(db, userId).filter(
    (r) => r.skillId === parsed.skillId && r.tier === 'minor',
  ).length
  const milestones = minorMilestones(level)
  if (ownedMinor >= milestones.length) return { ok: false, error: 'no pending talent choice' }
  const nextMilestone = milestones[ownedMinor]!
  if (parsed.milestone !== nextMilestone) return { ok: false, error: 'not the current milestone' }
  const option = minorOptions(parsed.skillId, nextMilestone).find((o) => o.id === talentId)
  if (!option) return { ok: false, error: 'invalid talent option' }
  addTalent(db, userId, {
    talentId: option.id,
    skillId: option.skillId,
    tier: 'minor',
    milestone: nextMilestone,
  })
  bus.emit('talent.chosen', {
    userId,
    talentId: option.id,
    skillId: option.skillId,
    tier: 'minor',
    milestone: nextMilestone,
  })
  return { ok: true, talent: option }
}

/** Per-skill talent state for the UI (pending choice + owned talents). */
export function talentView(db: Db, userId: string) {
  const owned = listTalents(db, userId)
  return SKILLS.map((s) => {
    const level = skillLevelOf(db, userId, s.id)
    const mine = owned.filter((r) => r.skillId === s.id)
    const ownedMinor = mine.filter((r) => r.tier === 'minor').length
    const milestones = minorMilestones(level)
    const pending = milestones.length > ownedMinor
    const nextMilestone = pending ? milestones[ownedMinor]! : null
    // Minor milestones are 5, 15, 25, … so the next one to earn is deterministic.
    const nextMinor = 5 + 10 * ownedMinor
    const nextMajor = Math.floor(level / 10) * 10 + 10
    return {
      skillId: s.id,
      level,
      pendingChoice: pending,
      milestone: nextMilestone,
      options: nextMilestone ? minorOptions(s.id, nextMilestone) : [],
      majors: mine.filter((r) => r.tier === 'major').length,
      nextMinor,
      nextMajor,
      owned: resolveTalents(mine).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        tier: t.tier,
        milestone: t.milestone,
        mods: t.mods,
      })),
    }
  })
}

// --- professions: materials --------------------------------------------------

/** Grants materials, applying the profession's yield + double bonuses. */
export function grantItems(
  db: Db,
  bus: EventBus,
  userId: string,
  skillId: SkillId,
  costs: Cost[],
  rand: () => number = Math.random,
): void {
  const bonus = aggregateBonuses(db, userId)
  for (const c of costs) {
    const count = applyYield(c.count, bonus.yield(skillId), bonus.double(skillId), rand)
    if (count <= 0) continue
    addItems(db, userId, c.item, count)
    bus.emit('item.gained', {
      userId,
      itemId: c.item,
      count,
      total: getItemCount(db, userId, c.item),
    })
  }
}

export function consumeItems(db: Db, bus: EventBus, userId: string, costs: Cost[]): void {
  for (const c of costs) {
    addItems(db, userId, c.item, -c.count)
    bus.emit('item.consumed', {
      userId,
      itemId: c.item,
      count: c.count,
      total: getItemCount(db, userId, c.item),
    })
  }
}

export function skillSummaries(db: Db, userId: string) {
  const map = new Map(listSkillProgress(db, userId).map((r) => [r.skillId, r]))
  return SKILLS.map((s) => {
    const xp = map.get(s.id)?.xp ?? 0
    const info = skillLevelInfo(xp)
    return { skillId: s.id, xp, ...info }
  })
}

export function inventoryView(db: Db, userId: string) {
  const counts = new Map(listInventory(db, userId).map((r) => [r.itemId, r.count]))
  return ITEMS.map((i) => ({ itemId: i.id, count: counts.get(i.id) ?? 0 }))
}

export interface ActionState {
  unlocked: boolean
  missingUnlocks: UnlockReq[]
  affordable: boolean
  missing: Cost[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
}

export function actionState(db: Db, userId: string, action: ActionDef): ActionState {
  const missingUnlocksList = missingUnlocks(action, (s) => skillLevelOf(db, userId, s))
  const missing = missingMaterials(action, (i) => getItemCount(db, userId, i))
  let equipOk = true
  let equipMissing: { slot: string; tag: string } | null = null
  if (action.equip) {
    const eq = listEquipment(db, userId).find((e) => e.slot === action.equip!.slot)
    const item = eq ? ITEM_BY_ID.get(eq.itemId) : undefined
    equipOk = Boolean(item?.tags?.includes(action.equip.tag))
    if (!equipOk) equipMissing = action.equip
  }
  return {
    unlocked: missingUnlocksList.length === 0 && equipOk,
    missingUnlocks: missingUnlocksList,
    affordable: missing.length === 0,
    missing,
    equipOk,
    equipMissing,
  }
}

// --- equipment ---------------------------------------------------------------

export function equipItem(
  db: Db,
  bus: EventBus,
  userId: string,
  itemId: string,
): { ok: boolean; error?: string } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot) return { ok: false, error: 'not equippable' }
  if (getItemCount(db, userId, itemId) < 1) return { ok: false, error: 'not in your bank' }
  const current = listEquipment(db, userId).find((e) => e.slot === item.slot)
  addItems(db, userId, itemId, -1)
  if (current) addItems(db, userId, current.itemId, 1)
  setEquipment(db, userId, item.slot, itemId)
  bus.emit('item.equipped', { userId, itemId, slot: item.slot })
  return { ok: true }
}

export function unequipItem(db: Db, userId: string, slot: string): void {
  const current = listEquipment(db, userId).find((e) => e.slot === slot)
  if (current) addItems(db, userId, current.itemId, 1)
  setEquipment(db, userId, slot, null)
}

// --- combat (Phase 8, docs/DESIGN.md §13.5) ----------------------------------

export interface PlayerCombat {
  maxHp: number
  power: number
  armour: number
  weaponPower: number
  bodyArmour: number
}

/** The player's combat numbers for a given combat profession. */
export function getPlayerCombat(db: Db, userId: string, combatSkill: SkillId): PlayerCombat {
  const b = aggregateBonuses(db, userId)
  const eq = listEquipment(db, userId)
  const weapon = eq.find((e) => e.slot === 'weapon')
  const body = eq.find((e) => e.slot === 'body')
  const weaponPower = weapon ? (ITEM_BY_ID.get(weapon.itemId)?.power ?? 0) : 0
  const bodyArmour = body ? (ITEM_BY_ID.get(body.itemId)?.armour ?? 0) : 0
  return {
    maxHp: playerMaxHp(skillLevelOf(db, userId, 'constitution'), b.hp, bodyArmour),
    power: playerPower(skillLevelOf(db, userId, combatSkill), weaponPower, b.damage),
    armour: bodyArmour,
    weaponPower,
    bodyArmour,
  }
}

export function monsterState(
  db: Db,
  userId: string,
  m: MonsterDef,
): { unlocked: boolean; missing: UnlockReq[]; equipMissing: { slot: string; tag: string } | null } {
  const missing = (m.requires ?? []).filter((r) => skillLevelOf(db, userId, r.skill) < r.level)
  let equipMissing: { slot: string; tag: string } | null = null
  if (m.equip) {
    const eq = listEquipment(db, userId).find((e) => e.slot === m.equip!.slot)
    const item = eq ? ITEM_BY_ID.get(eq.itemId) : undefined
    if (!item?.tags?.includes(m.equip.tag)) equipMissing = m.equip
  }
  return { unlocked: missing.length === 0 && !equipMissing, missing, equipMissing }
}

// --- auto-used consumables ---------------------------------------------------

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

export function startEncounter(
  db: Db,
  bus: EventBus,
  userId: string,
  monsterId: string,
):
  | {
      ok: true
      monster: MonsterDef
      encounter: { monsterId: string; monsterHp: number; playerHp: number; playerMaxHp: number }
      drank: { item: string; buff: { kind: 'power' | 'maxHp'; value: number } } | null
    }
  | {
      ok: false
      error: string
      missing?: UnlockReq[]
      equipMissing?: { slot: string; tag: string }
    } {
  const m = MONSTER_BY_ID.get(monsterId)
  if (!m) return { ok: false, error: 'unknown monster' }
  const state = monsterState(db, userId, m)
  if (!state.unlocked) {
    return {
      ok: false,
      error: 'locked',
      missing: state.missing,
      equipMissing: state.equipMissing ?? undefined,
    }
  }

  // auto-drink the best potion at the start of the fight
  const pc = getPlayerCombat(db, userId, m.combatSkill)
  let maxHp = pc.maxHp
  let powerBonus = 0
  let potionId: string | null = null
  let drank: { item: string; buff: { kind: 'power' | 'maxHp'; value: number } } | null = null
  const potion = bestPotion(db, userId)
  if (potion?.buff) {
    consumeItems(db, bus, userId, [{ item: potion.id, count: 1 }])
    potionId = potion.id
    drank = { item: potion.id, buff: potion.buff }
    if (potion.buff.kind === 'power') powerBonus = potion.buff.value
    else maxHp = Math.round(maxHp * (1 + potion.buff.value))
  }

  upsertEncounter(db, userId, {
    monsterId,
    monsterHp: m.hp,
    playerHp: maxHp,
    playerMaxHp: maxHp,
    powerBonus,
    potionId,
    foodEaten: 0,
    totalDamage: 0,
    xpEarned: 0,
  })
  return {
    ok: true,
    monster: m,
    encounter: { monsterId, monsterHp: m.hp, playerHp: maxHp, playerMaxHp: maxHp },
    drank,
  }
}

export function grantExactItems(db: Db, bus: EventBus, userId: string, costs: Cost[]): void {
  for (const c of costs) {
    if (c.count <= 0) continue
    addItems(db, userId, c.item, c.count)
    bus.emit('item.gained', {
      userId,
      itemId: c.item,
      count: c.count,
      total: getItemCount(db, userId, c.item),
    })
  }
}

export interface HitOutcome {
  correct: boolean
  damage: number
  monsterHp: number
  playerDamage: number
  playerHp: number
  playerMaxHp: number
  outcome: 'ongoing' | 'won' | 'lost'
  drops: Cost[]
  xp: number
  ate: { item: string; heal: number; playerHp: number } | null
  grantedTalents: TalentDef[]
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
  const m = MONSTER_BY_ID.get(enc.monsterId)
  if (!m) {
    clearEncounter(db, userId)
    return null
  }
  const pc = getPlayerCombat(db, userId, m.combatSkill)
  const maxHp = enc.playerMaxHp || pc.maxHp
  let monsterHp = enc.monsterHp
  let playerHp = enc.playerHp
  let foodEaten = enc.foodEaten
  let damage = 0
  let playerDamage = 0
  let xp = 0
  let ate: { item: string; heal: number; playerHp: number } | null = null
  const drops: Cost[] = []

  // auto-eat when HP falls below the threshold (before the exchange)
  if (playerHp > 0 && playerHp / maxHp < foodThreshold(db, userId)) {
    const food = bestFood(db, userId)
    if (food?.heal) {
      consumeItems(db, bus, userId, [{ item: food.id, count: 1 }])
      playerHp = Math.min(maxHp, playerHp + food.heal)
      foodEaten += 1
      ate = { item: food.id, heal: food.heal, playerHp }
    }
  }

  if (correct) {
    damage = Math.max(1, Math.round(pc.power * (1 + enc.powerBonus)))
    monsterHp = Math.max(0, monsterHp - damage)
    xp = Math.max(1, Math.round(m.xp / 4))
    bus.emit('combat.hit', { userId, monsterId: m.id, damage, monsterHp })
  } else {
    playerDamage = incomingDamage(m.damage, pc.armour)
    playerHp = Math.max(0, playerHp - playerDamage)
  }

  let outcome: HitOutcome['outcome'] = 'ongoing'
  if (monsterHp <= 0) {
    outcome = 'won'
    xp += m.xp
    drops.push(...rollDrops(m.drops, aggregateBonuses(db, userId).drop, rand))
  } else if (playerHp <= 0) {
    outcome = 'lost'
  }

  const award = xp > 0 ? awardSkillXp(db, bus, userId, m.combatSkill, xp) : null
  if (outcome === 'won') {
    grantExactItems(db, bus, userId, drops)
    awardXp(db, bus, userId, m.xp, 'combat', m.id)
    bus.emit('combat.ended', { userId, monsterId: m.id, outcome: 'won' })
    clearEncounter(db, userId)
  } else if (outcome === 'lost') {
    bus.emit('combat.ended', { userId, monsterId: m.id, outcome: 'lost' })
    clearEncounter(db, userId)
  } else {
    upsertEncounter(db, userId, {
      monsterId: m.id,
      monsterHp,
      playerHp,
      playerMaxHp: maxHp,
      powerBonus: enc.powerBonus,
      potionId: enc.potionId,
      foodEaten,
      totalDamage: enc.totalDamage + damage,
      xpEarned: enc.xpEarned + xp,
    })
  }

  return {
    correct,
    damage,
    monsterHp,
    playerDamage,
    playerHp,
    playerMaxHp: maxHp,
    outcome,
    drops,
    xp,
    ate,
    grantedTalents: award?.grantedTalents ?? [],
  }
}

// --- spaced repetition + curriculum (Phase 9, docs/DESIGN.md §13.6) ----------

/** The scheduling outcome returned to the API/UI after a review. */
export interface ReviewSchedule {
  rating: Rating
  state: FsrsState['state']
  intervalDays: number
  dueAt: number
  stability: number
  difficulty: number
  step: number
  reps: number
  lapses: number
}

/** A user's desired retention as a fraction (Anki-style percent, default 90%). */
export function desiredRetentionFor(db: Db, userId: string): number {
  const raw = Number(getUserSetting(db, userId, 'desiredRetention') ?? 90)
  const pct = Number.isFinite(raw) ? Math.min(97, Math.max(70, Math.round(raw))) : 90
  return pct / 100
}

/** Advances a card's FSRS-6 schedule after a review and emits `srs.updated`. */
export function recordReview(
  db: Db,
  bus: EventBus,
  userId: string,
  cardId: string,
  score: number,
  correct: boolean,
): ReviewSchedule {
  const row = getSrs(db, userId, cardId)
  const prev: FsrsState = row
    ? {
        state: row.state as FsrsState['state'],
        step: row.step,
        stability: row.stability,
        difficulty: row.difficulty,
        reps: row.reps,
        lapses: row.lapses,
        intervalDays: row.intervalDays,
        dueAt: row.dueAt,
        lastReviewAt: row.lastReviewAt,
        lastRating: (row.lastRating as Rating | null) ?? null,
      }
    : NEW_STATE
  const now = Date.now()
  const rating = ratingFromScore(score, correct)
  const { state, intervalDays, dueAt } = schedule(prev, rating, now, {
    desiredRetention: desiredRetentionFor(db, userId),
  })
  upsertSrs(db, userId, cardId, {
    state: state.state,
    step: state.step,
    stability: state.stability,
    difficulty: state.difficulty,
    reps: state.reps,
    lapses: state.lapses,
    intervalDays: state.intervalDays,
    dueAt: state.dueAt,
    lastRating: state.lastRating,
    lastReviewAt: state.lastReviewAt ?? now,
  })
  bus.emit('srs.updated', {
    userId,
    cardId,
    reps: state.reps,
    dueAt: state.dueAt,
    intervalDays: state.intervalDays,
    rating,
    state: state.state,
  })
  return {
    rating,
    state: state.state,
    intervalDays,
    dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    step: state.step,
    reps: state.reps,
    lapses: state.lapses,
  }
}

export function srsStateMap(db: Db, userId: string): Map<string, FsrsState> {
  return new Map(
    listSrs(db, userId).map((r) => [
      r.cardId,
      {
        state: r.state as FsrsState['state'],
        step: r.step,
        stability: r.stability,
        difficulty: r.difficulty,
        reps: r.reps,
        lapses: r.lapses,
        intervalDays: r.intervalDays,
        dueAt: r.dueAt,
        lastReviewAt: r.lastReviewAt,
        lastRating: (r.lastRating as Rating | null) ?? null,
      } satisfies FsrsState,
    ]),
  )
}

export interface SrsStats {
  total: number
  learned: number
  due: number
  new: number
}

export function srsStats(db: Db, userId: string): SrsStats {
  const ids = listCards(db, userId).map((c) => c.id)
  const map = srsStateMap(db, userId)
  const now = Date.now()
  return {
    total: ids.length,
    learned: ids.filter((id) => isLearned(map.get(id))).length,
    due: countDue(ids, map, now),
    new: countNew(ids, map),
  }
}

/** The guided path: each deck split into lessons with completion state. */
export function curriculumView(db: Db, userId: string) {
  seedStarterDecks(db, userId)
  const decks = listDecks(db, userId)
  const srsMap = srsStateMap(db, userId)
  const completed = new Set(listLessonProgress(db, userId).map((r) => r.lessonId))
  const now = Date.now()

  return decks.map((d) => {
    const ids = listCards(db, userId, d.id).map((c) => c.id)
    const lessons = buildLessons(d.level ?? '', ids).map((l) => {
      const learned = l.cardIds.filter((id) => isLearned(srsMap.get(id))).length
      const due = countDue(l.cardIds, srsMap, now)
      return {
        ...l,
        cards: l.cardIds.length,
        learned,
        due,
        complete: completed.has(l.id) || (l.cardIds.length > 0 && learned >= l.cardIds.length),
      }
    })
    return {
      deckId: d.id,
      name: d.name,
      level: d.level,
      targetLang: d.targetLang,
      cardCount: Number(d.cardCount),
      learned: ids.filter((id) => isLearned(srsMap.get(id))).length,
      due: countDue(ids, srsMap, now),
      lessons,
    }
  })
}

/** Marks a lesson complete when every card in it has been learned. */
export function checkLessonCompletion(
  db: Db,
  bus: EventBus,
  userId: string,
  lessonId: string,
): boolean {
  const [level, indexStr] = lessonId.split(':')
  const index = Number(indexStr) - 1
  if (!level || !Number.isFinite(index) || index < 0) return false
  const deck = listDecks(db, userId).find((d) => d.level === level)
  if (!deck) return false
  const ids = listCards(db, userId, deck.id).map((c) => c.id)
  const lesson = buildLessons(level, ids)[index]
  if (!lesson || lesson.cardIds.length === 0) return false
  const srsMap = srsStateMap(db, userId)
  const done = lesson.cardIds.every((id) => isLearned(srsMap.get(id)))
  if (done) {
    completeLesson(db, userId, lessonId)
    bus.emit('lesson.completed', { userId, lessonId })
  }
  return done
}
