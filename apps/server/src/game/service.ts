import type { Db } from '../db/client'
import {
  addItems,
  addTalent,
  addXpEvent,
  getItemCount,
  getSkillXp,
  getStats,
  hasTalent,
  listEquipment,
  listInventory,
  listSkillProgress,
  listTalents,
  setEquipment,
  setSkillXp,
  sumXp,
  upsertStats,
  xpEventsFor,
} from '../db/repo'
import type { EventBus } from '../events'
import { levelInfo } from './levels'
import { computeBonuses, applyYield, type Bonuses } from './modifiers'
import {
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  type ActionDef,
  type Cost,
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

/** Per-skill talent state for the UI (pending choice + owned counts). */
export function talentView(db: Db, userId: string) {
  const owned = listTalents(db, userId)
  return SKILLS.map((s) => {
    const level = skillLevelOf(db, userId, s.id)
    const ownedMinor = owned.filter((r) => r.skillId === s.id && r.tier === 'minor').length
    const milestones = minorMilestones(level)
    const pending = milestones.length > ownedMinor
    const nextMilestone = pending ? milestones[ownedMinor]! : null
    return {
      skillId: s.id,
      level,
      pendingChoice: pending,
      milestone: nextMilestone,
      options: nextMilestone ? minorOptions(s.id, nextMilestone) : [],
      majors: owned.filter((r) => r.skillId === s.id && r.tier === 'major').length,
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
