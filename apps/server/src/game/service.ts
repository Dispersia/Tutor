import type { Db } from '../db/client'
import {
  addGatherLog,
  addGearInstance,
  addGearSet,
  addItems,
  addSrsReview,
  addTalent,
  addXpEvent,
  clearEncounter,
  completeLesson,
  dailyReviewCounts,
  deckKey,
  deleteGearInstance,
  deleteGearSet,
  getActionXp,
  getEncounter,
  getGearInstance,
  getItemCount,
  getPlayerHp,
  getRigState,
  getSrs,
  getStats,
  getUserSetting,
  listActionProgress,
  listCards,
  listDecks,
  listEquipment,
  listGearInstances,
  listGearSets,
  listInventory,
  listLessonProgress,
  listRigStates,
  listSrs,
  listTalents,
  replaceTalent,
  setActionXp,
  setEquipment,
  setGearInstanceEnchant,
  setPlayerHp,
  setRigState,
  sumXp,
  updateGearSet,
  upsertEncounter,
  upsertSrs,
  upsertStats,
  xpEventsFor,
} from '../db/repo'
import type { EventBus } from '../events'
import { publicDeckSettings } from '../deck/settings'
import { readDailyExtra, readStudyPrefs } from './study'
import { pinyinToZhuyin } from '../seed/zhuyin'
import { buildLessons } from './curriculum'
import {
  DAY_MS,
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
import {
  BANDS,
  BAND_BY_ID,
  bandBonuses,
  bandLevelInfo,
  type BandBonuses,
  type BandDef,
  type BandId,
  type BandStat,
} from './bands'
import { levelInfo } from './levels'
import {
  IDLE,
  MAX_LIVE_RIGS,
  capLiveRigs,
  extendRig,
  liveRigCount,
  newRig,
  rigIntervalSec,
  rigMaxed,
  rigRunProgress,
  rigRunSec,
  settleRig,
  type RigState,
} from './idle'
import { computeBonuses, applyYield, type Bonuses } from './modifiers'
import {
  ACTION_BY_ID,
  ACTION_MAX_LEVEL,
  ACTIONS,
  ITEMS,
  ITEM_BY_ID,
  SKILLS,
  SKILL_BY_ID,
  SLOTS,
  type ActionDef,
  type ArmourType,
  type CombatStyle,
  type Cost,
  type GearQuality,
  type GearStats,
  type ItemDef,
  type SkillId,
  type Slot,
  type UnlockReq,
  actionChoice,
  actionConsumes,
  actionExpected,
  actionLevelInfo,
  actionOdds,
  actionRoll,
  actionsForSkill,
  armourTypeForStyle,
  combatStyleForTags,
  missingUnlocks,
  dustId,
  slotFamily,
  weaponSkill,
  GEM_BY_TYPE,
  GEM_TYPES,
  DISTILL_XP_PER_VALUE,
  ENCHANT_BY_ID,
  essenceFamily,
  essenceId,
  itemValue,
  type EnchantDef,
  type GemType,
} from './skills'
import {
  addStats,
  activeSetBonuses,
  applySetBonuses,
  combatStyleForSkill,
  critPercent,
  deriveStats,
  emptyStats,
  gearScore,
  hastePercent,
  itemRequirements,
  masteryPercent,
  meetsRequirements,
  parseStats,
  rollGearStats,
  statsOf,
  sumStats,
  type ActiveSetBonus,
  type MissingRequirement,
} from './gear'
import {
  MASTERY_MILESTONES,
  SYNERGY,
  type TalentDef,
  masteryOptions,
  optionsFor,
  parseTalentId,
  resolveTalents,
  talentMilestones,
  talentOptions,
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

/** Monday of the UTC week containing `day` (the activity map's column start). */
export function weekStart(day: string): string {
  const dt = new Date(`${day}T00:00:00Z`)
  const dow = (dt.getUTCDay() + 6) % 7 // Monday = 0
  return shiftDay(day, -dow)
}

export interface ActivityDay {
  day: string
  xp: number
}

/**
 * Daily XP for the last `weeks` weeks as a heat-map grid: columns are weeks
 * (Monday first), the last column is the current week, oldest day first. One
 * pass over the ledger — never one query per day (docs/DESIGN.md §13).
 */
export function activitySeries(
  db: Db,
  userId: string,
  weeks = 18,
): { today: string; days: ActivityDay[] } {
  const today = todayDay()
  const byDay = new Map<string, number>()
  for (const r of xpEventsFor(db, userId)) {
    const d = todayDay(r.createdAt)
    byDay.set(d, (byDay.get(d) ?? 0) + r.amount)
  }
  const gridStart = shiftDay(weekStart(today), -(weeks - 1) * 7)
  const days: ActivityDay[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = shiftDay(gridStart, i)
    days.push({ day: d, xp: byDay.get(d) ?? 0 })
  }
  return { today, days }
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
  /** lifetime review XP (the daily-goal / heat-map metric, not the level) */
  xp: number
  /** the account level: the mean of every profession's level, out of 100 */
  level: number
  /** how far the average profession is toward its next level (0..1) */
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
}

export function summary(db: Db, userId: string): GameSummary {
  const s = getStats(db, userId)
  const today = todayDay()
  const daily = dailyXp(db, userId, today)
  const goal = s.dailyGoal || 50
  const account = accountLevel(db, userId)
  return {
    xp: s.xpTotal,
    level: account.level,
    progress: account.progress,
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

// --- action levels + bonuses (docs/DESIGN.md §13.5) --------------------------

/** Every action's level for a user; actions never trained sit at level 1. */
export function actionLevelMap(db: Db, userId: string): Map<string, number> {
  return new Map(
    listActionProgress(db, userId).map((r) => [r.actionId, actionLevelInfo(r.xp).level]),
  )
}

export function actionLevelOf(db: Db, userId: string, actionId: string): number {
  return (actionLevelMap(db, userId).get(actionId) ?? 1) as number
}

/**
 * A profession's level — the **mean** of its actions' levels, so it always reads
 * out of 100 however much content the profession has. Adding an action (a new ore,
 * say) raises the denominator and so lowers the level until you train it: that is
 * the point, a maxed profession stays 100 and old progress is "reduced by the new
 * available levels".
 */
export function skillLevelOf(db: Db, userId: string, skillId: SkillId): number {
  const acts = actionsForSkill(skillId)
  if (!acts.length) return 1
  const levels = actionLevelMap(db, userId)
  const total = acts.reduce((n, a) => n + (levels.get(a.id) ?? 1), 0)
  return Math.round(total / acts.length)
}

/** The action a profession-awarded XP lands on (combat has one action per skill). */
export function primaryActionOf(skillId: SkillId): string {
  return actionsForSkill(skillId)[0]!.id
}

export function aggregateBonuses(db: Db, userId: string): Bonuses {
  return computeBonuses(actionLevelMap(db, userId), resolveTalents(listTalents(db, userId)))
}

// --- tier bands (docs/DESIGN.md §13.5.3) -------------------------------------

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
export function bandBonusesFor(db: Db, userId: string): BandBonuses {
  return bandBonuses(bandLevelMap(db, userId))
}

/**
 * The band a piece of gear belongs to, by its crafting line and item level. Bows and
 * staves form the `wood` line; armour families map 1:1. Used to pick the salvage
 * reagent, so a salvaged piece yields its own tier's feedstock.
 */
export function bandForItem(item: ItemDef): BandDef | undefined {
  const line =
    item.tags?.includes('bow') || item.tags?.includes('staff') ? 'wood' : item.armourType
  if (!line) return undefined
  const tier = Math.max(1, Math.round(item.itemLevel ?? 1))
  return BANDS.find((b) => b.line === line && b.tier === tier)
}

// --- action XP + talents -----------------------------------------------------

export interface ActionAward {
  actionId: string
  skillId: SkillId
  /** the action's total XP after the award */
  xp: number
  /** the action's own level after the award */
  level: number
  /** the profession's derived level after the award */
  skillLevel: number
  /** the action levelled up */
  leveledUp: boolean
  /** XP actually credited (after bonuses) */
  gained: number
  /** the profession milestone whose talent choice just opened up (or null) */
  talentUnlocked: number | null
}

export function awardActionXp(
  db: Db,
  bus: EventBus,
  userId: string,
  actionId: string,
  amount: number,
): ActionAward {
  const action = ACTION_BY_ID.get(actionId)!
  const beforeXp = getActionXp(db, userId, actionId)
  const bonus = aggregateBonuses(db, userId)
  const gained = Math.max(0, Math.round(amount * (1 + bonus.xp(actionId) + bonus.globalXp)))
  const xp = beforeXp + gained
  const info = actionLevelInfo(xp)
  const before = actionLevelInfo(beforeXp).level
  const skillBefore = skillLevelOf(db, userId, action.skillId)
  setActionXp(db, userId, actionId, xp, info.level)
  bus.emit('skill.xp', {
    userId,
    actionId,
    skillId: action.skillId,
    amount: gained,
    xp,
    level: info.level,
  })

  const leveledUp = info.level > before
  let talentUnlocked: number | null = null
  if (leveledUp) {
    bus.emit('skill.level.up', {
      userId,
      actionId,
      skillId: action.skillId,
      level: info.level,
    })
    const skillLevel = skillLevelOf(db, userId, action.skillId)
    const milestone = Math.floor(skillLevel / 10) * 10
    if (milestone >= 10 && milestone > skillBefore) talentUnlocked = milestone
  }
  return {
    actionId,
    skillId: action.skillId,
    xp,
    level: info.level,
    skillLevel: skillLevelOf(db, userId, action.skillId),
    leveledUp,
    gained,
    talentUnlocked,
  }
}

interface TalentRow {
  talentId: string
  tier: string
  milestone: number
}

/** Writes a talent, replacing any already taken at the same tier + milestone. */
function applyTalent(
  db: Db,
  bus: EventBus,
  userId: string,
  option: TalentDef,
  mine: TalentRow[],
): { ok: boolean; talent: TalentDef } {
  const existing = mine.find((r) => r.tier === option.tier && r.milestone === option.milestone)
  if (existing) {
    if (existing.talentId === option.id) return { ok: true, talent: option }
    replaceTalent(db, userId, existing.talentId, {
      talentId: option.id,
      skillId: option.skillId,
      tier: option.tier,
      milestone: option.milestone,
    })
    bus.emit('talent.changed', {
      userId,
      talentId: option.id,
      fromTalentId: existing.talentId,
      skillId: option.skillId,
      milestone: option.milestone,
      tier: option.tier,
    })
    return { ok: true, talent: option }
  }
  addTalent(db, userId, {
    talentId: option.id,
    skillId: option.skillId,
    tier: option.tier,
    milestone: option.milestone,
  })
  bus.emit('talent.chosen', {
    userId,
    talentId: option.id,
    skillId: option.skillId,
    milestone: option.milestone,
    tier: option.tier,
  })
  return { ok: true, talent: option }
}

/**
 * Chooses a talent — a **choice** at a 10-level milestone or a **mastery** capstone
 * at Lv 50/100 — or changes one already taken at that milestone (a free respec).
 * Mastery options are additionally gated on a level in the profession that feeds
 * this one, so a mastery has to be earned by cross-training.
 */
export function chooseTalent(
  db: Db,
  bus: EventBus,
  userId: string,
  talentId: string,
): { ok: boolean; error?: string; talent?: TalentDef } {
  const parsed = parseTalentId(talentId)
  if (!parsed) return { ok: false, error: 'not a talent' }
  const level = skillLevelOf(db, userId, parsed.skillId)
  const option = optionsFor(parsed.skillId, parsed.milestone, parsed.kind).find(
    (o) => o.id === talentId,
  )
  if (!option) return { ok: false, error: 'invalid talent option' }

  const mine = listTalents(db, userId).filter((r) => r.skillId === parsed.skillId)

  if (parsed.kind === 'mastery') {
    if (!MASTERY_MILESTONES.includes(parsed.milestone)) {
      return { ok: false, error: 'not a mastery milestone' }
    }
    if (level < parsed.milestone) return { ok: false, error: 'milestone not reached' }
    const unmet = option.requires.filter((r) => skillLevelOf(db, userId, r.skill) < r.level)
    if (unmet.length) {
      return {
        ok: false,
        error: `requires ${unmet.map((r) => `${r.skill} ${r.level}`).join(', ')}`,
      }
    }
    return applyTalent(db, bus, userId, option, mine)
  }

  // Choice tier: every 10 levels, taken in order with no skipping ahead.
  const milestones = talentMilestones(level)
  if (!milestones.includes(parsed.milestone)) return { ok: false, error: 'milestone not reached' }
  const choices = mine.filter((r) => r.tier === 'choice')
  const existing = choices.find((r) => r.milestone === parsed.milestone)
  if (!existing) {
    if (choices.length >= milestones.length) {
      return { ok: false, error: 'no pending talent choice' }
    }
    const nextMilestone = milestones[choices.length]!
    if (parsed.milestone !== nextMilestone) return { ok: false, error: 'not the current milestone' }
  }
  return applyTalent(db, bus, userId, option, mine)
}

/** The shape `talentView` returns for one owned talent (choice or mastery). */
function ownedView(db: Db, userId: string, rows: TalentRow[]) {
  return resolveTalents(rows).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    milestone: t.milestone,
    tier: t.tier,
    mods: t.mods,
    requires: t.requires.map((r) => ({
      ...r,
      met: skillLevelOf(db, userId, r.skill) >= r.level,
    })),
    // the other options at the same tier + milestone (so it can be changed)
    options: optionsFor(t.skillId, t.milestone, t.tier).map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      mods: o.mods,
      requires: o.requires.map((r) => ({
        ...r,
        met: skillLevelOf(db, userId, r.skill) >= r.level,
      })),
    })),
  }))
}

/** Per-skill talent state for the UI (choice milestone + mastery capstones). */
export function talentView(db: Db, userId: string) {
  const owned = listTalents(db, userId)
  return SKILLS.map((s) => {
    const level = skillLevelOf(db, userId, s.id)
    const mine = owned.filter((r) => r.skillId === s.id) as TalentRow[]
    const choices = mine.filter((r) => r.tier === 'choice')
    const masteries = mine.filter((r) => r.tier === 'mastery')

    const milestones = talentMilestones(level)
    const pending = milestones.length > choices.length
    const nextMilestone = pending ? milestones[choices.length]! : null
    // Every 10-level choice in the game; `null` once they are all taken.
    const allMilestones = talentMilestones(ACTION_MAX_LEVEL)
    const nextChoice = pending ? nextMilestone : (allMilestones[choices.length] ?? null)

    // A mastery capstone opens once its level is reached and none is taken there.
    const masteryPending = MASTERY_MILESTONES.filter(
      (m) => level >= m && !masteries.some((t) => t.milestone === m),
    ).map((m) => ({
      milestone: m,
      options: masteryOptions(s.id, m).map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        mods: o.mods,
        requires: o.requires.map((r) => ({
          ...r,
          met: skillLevelOf(db, userId, r.skill) >= r.level,
        })),
      })),
    }))

    // The milestones where this profession's synergy talent was taken. It can be
    // picked at *every* milestone (one of the three options each time), so the
    // copies stack — `taken.length` is how many are active.
    const syn = SYNERGY[s.id]
    const taken = mine
      .filter(
        (r) =>
          r.tier === 'choice' &&
          (resolveTalents([r])[0]?.mods.some((m) => m.synergy === s.id) ?? false),
      )
      .map((r) => r.milestone)
      .sort((a, b) => a - b)

    return {
      skillId: s.id,
      level,
      pendingChoice: pending,
      milestone: nextMilestone,
      options: nextMilestone ? talentOptions(s.id, nextMilestone) : [],
      /** the next 10-level milestone, or null once every one is taken */
      nextMilestone: nextChoice,
      // The profession this one trades with: it feeds the partner (and the partner
      // gates this profession's mastery capstone). Shown as the web on the board.
      synergy: {
        target: syn.target,
        name: SKILL_BY_ID.get(syn.target)?.name ?? syn.target,
        label: syn.name,
        /** milestones where the packing talent is taken (empty = no link shown) */
        taken,
      },
      owned: ownedView(db, userId, choices),
      mastery: {
        milestones: MASTERY_MILESTONES,
        /** the next not-yet-reached capstone, or null once both are done */
        next: MASTERY_MILESTONES.find((m) => level < m) ?? null,
        pending: masteryPending,
        owned: ownedView(db, userId, masteries),
      },
    }
  })
}

// --- professions: materials --------------------------------------------------

/** Grants materials, applying the action's own yield + double bonuses. */
export function grantItems(
  db: Db,
  bus: EventBus,
  userId: string,
  actionId: string,
  costs: Cost[],
  rand: () => number = Math.random,
): Cost[] {
  const bonus = aggregateBonuses(db, userId)
  const granted: Cost[] = []
  for (const c of costs) {
    const count = applyYield(c.count, bonus.yield(actionId), bonus.double(actionId), rand)
    if (count <= 0) continue
    addItems(db, userId, c.item, count)
    recordGearCrafts(db, userId, c.item, count, rand)
    granted.push({ item: c.item, count })
    bus.emit('item.gained', {
      userId,
      itemId: c.item,
      count,
      total: getItemCount(db, userId, c.item),
    })
  }
  return granted
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

// --- idle rigs (docs/DESIGN.md §13.5.1) --------------------------------------

/**
 * The canonical settle order — **gathering → support → artisan → combat** — so a
 * miner's output is available to a smith in the same pass. The order is part of
 * the contract: same bank, same result, every time.
 */
const SETTLE_RANK: Record<string, number> = {
  gathering: 0,
  support: 1,
  artisan: 2,
  combat: 3,
}
const SETTLE_ORDER = [...ACTIONS].sort(
  (a, b) =>
    (SETTLE_RANK[SKILL_BY_ID.get(a.skillId)?.category ?? ''] ?? 9) -
    (SETTLE_RANK[SKILL_BY_ID.get(b.skillId)?.category ?? ''] ?? 9),
)

/** One action's rig as the UI needs it: rate, run clock and recipe. */
export interface IdleRigView {
  actionId: string
  /** lifetime drills that powered this rig */
  completions: number
  active: boolean
  /** ms epoch when the run ends (0 = still) */
  runEndsAt: number
  /** whole seconds left in the run */
  secondsLeft: number
  /** whole seconds a fresh completion's run lasts at this level */
  runSec: number
  /** the run-length cap (seconds): the longest a run can ever get */
  maxRunSec: number
  /** completions at which a run reaches `maxRunSec` — the end of the climb */
  runFullAtCompletions: number
  /** how far the rig is toward the cap: 0 → 1 (§13.5.1) */
  runProgress: number
  /** whether the run has reached the cap — the rig is as good as it gets */
  maxed: boolean
  /** seconds between items right now */
  intervalSec: number
  /** expected-value bonus already baked into a run (yield + double) */
  yieldBonus: number
  /** action XP each craft hands over while the run is live (base, before talents) */
  xpPerCraft: number
  produces: Cost[]
  consumes: Cost[]
  /** the recipe choice the rig is running ('' = the action's first choice) */
  choice: string
}

export interface SettleReport {
  /** everything the runs produced since the last settle */
  gained: Cost[]
  /** everything the runs consumed */
  spent: Cost[]
  /** action XP the runs earned on their own this settle (actionId → XP) */
  xp: Map<string, number>
  /** post-settle rig state per action (for building views without a second query) */
  rigs: Map<string, RigState>
}

/** Fold a settled rig into the UI view. Pure. */
export function idleView(
  rig: RigState,
  action: ActionDef,
  now: number,
  yieldBonus: number,
): IdleRigView {
  return {
    actionId: action.id,
    completions: rig.completions,
    active: rig.runEndsAt > now,
    runEndsAt: rig.runEndsAt,
    secondsLeft: Math.max(0, Math.round((rig.runEndsAt - now) / 1000)),
    runSec: Math.round(rigRunSec(rig.completions)),
    maxRunSec: IDLE.maxRunSec,
    runFullAtCompletions: IDLE.runFullAtCompletions,
    runProgress: rigRunProgress(rig.completions),
    maxed: rigMaxed(rig.completions),
    intervalSec: rigIntervalSec(rig.completions, action.tier),
    yieldBonus,
    xpPerCraft: IDLE.xpPerCraft,
    produces: actionProduces(action, rig.choice || undefined),
    consumes: actionConsumes(action, rig.choice || undefined),
    choice: rig.choice ?? '',
  }
}

/**
 * Credit **every** running rig up to `now`, in one pass, against one mutable bank.
 * This is the whole idle engine: O(actions) = 67 rows of pure arithmetic, one
 * transaction, no timers. Hundreds of offline hours cost the same as one second.
 */
export function settleAll(db: Db, bus: EventBus, userId: string, now = Date.now()): SettleReport {
  const bank = new Map<string, number>()
  for (const r of listInventory(db, userId)) bank.set(r.itemId, r.count)
  const before = new Map(bank)
  const rigs = listRigStates(db, userId)
  const bonuses = aggregateBonuses(db, userId)
  const levels = actionLevelMap(db, userId)
  /** A prospect's odds at the current level (per choice); 1 if it cannot miss. */
  const successOf = (a: ActionDef, choiceId?: string): number =>
    actionOdds(a, choiceId, levels.get(a.id) ?? 1)

  const produced: Record<string, number> = {}
  const consumed: Record<string, number> = {}
  // Passive XP: every craft the run completed on its own levels the action, so a
  // machine left running pays out exactly like drilling does, just by the clock.
  const xp = new Map<string, number>()

  for (const action of SETTLE_ORDER) {
    const rig = rigs.get(action.id)
    if (!rig) continue
    const choiceId = rig.choice || undefined
    const res = settleRig(
      rig,
      {
        produces: actionProduces(action, choiceId),
        consumes: actionConsumes(action, choiceId),
        tier: action.tier,
        // an artisan's expected bonus product is folded into the run's rate
        yieldBonus: bonuses.yield(action.id) + bonuses.double(action.id),
        // a prospect consumes its ore but only pays out at its odds (§13.5.3.1)
        successChance: successOf(action, choiceId),
      },
      bank,
      now,
    )
    if (res.creditedSec > 0 || res.state.settledAt !== rig.settledAt) {
      setRigState(db, userId, action.id, res.state)
      rigs.set(action.id, res.state)
    }
    for (const [item, n] of Object.entries(res.produced)) produced[item] = (produced[item] ?? 0) + n
    for (const [item, n] of Object.entries(res.consumed)) consumed[item] = (consumed[item] ?? 0) + n
    if (res.crafted > 0) xp.set(action.id, res.crafted * IDLE.xpPerCraft)
  }

  // The live-rig cap (§13.5.1): never more than `MAX_LIVE_RIGS` runs at once. Trim
  // here too, so a save written before the cap (or one that raced a drill) settles
  // back to the rule on its next read.
  for (const id of capLiveRigs(rigs, now)) setRigState(db, userId, id, rigs.get(id)!)

  for (const [item, count] of bank) {
    const delta = count - (before.get(item) ?? 0)
    if (delta !== 0) addItems(db, userId, item, delta)
  }

  // Idle crafts also roll gear instances. Only the newly produced pieces are
  // recorded, so repeated settles never duplicate an earlier run's gear.
  for (const [item, count] of Object.entries(produced)) recordGearCrafts(db, userId, item, count)

  const gained = toCosts(produced)
  const spent = toCosts(consumed)
  for (const [actionId, amount] of xp) awardActionXp(db, bus, userId, actionId, amount)
  if (gained.length || spent.length) bus.emit('idle.settled', { userId, gained, spent })
  return { gained, spent, xp, rigs }
}

export interface DrillRigResult {
  gained: Cost[]
  consumed: Cost[]
  idle: IdleRigView | null
  xp: number
  /** rigs alive right now, after the cap (§13.5.1) */
  rigsRunning: number
  /** the live-rig cap — how many rigs may run at once */
  maxLiveRigs: number
  /** the rig this drill pushed over the cap and stopped, if any (§13.5.1) */
  stoppedRig: { actionId: string; name: string; skillId: string } | null
}

/**
 * The drill's real reward: pay every running rig up to now, land the **strike**
 * (the old flat yield, so the loop keeps its heartbeat), then power this action's
 * rig — every run is faster and longer than the last.
 */
export function completeAction(
  db: Db,
  bus: EventBus,
  userId: string,
  actionId: string,
  now = Date.now(),
  opts: { rand?: () => number; choiceId?: string } = {},
): DrillRigResult {
  const rand = opts.rand ?? Math.random
  const report = settleAll(db, bus, userId, now)
  const action = ACTION_BY_ID.get(actionId)
  const settledXp = [...report.xp.values()].reduce((n, v) => n + v, 0)
  if (!action) {
    return {
      gained: report.gained,
      consumed: report.spent,
      idle: null,
      xp: settledXp,
      rigsRunning: liveRigCount(report.rigs, now),
      maxLiveRigs: MAX_LIVE_RIGS,
      stoppedRig: null,
    }
  }

  // Which recipe the drill ran (prospect this ore / cut that gem): the one the UI
  // passed, else whatever the rig last ran, else the action's first choice.
  const current = getRigState(db, userId, actionId) ?? newRig()
  const choiceId = opts.choiceId ?? (current.choice || undefined)

  // A prospect consumes its input but only *pays out* at its odds (§13.5.3.1), and a
  // `table` action rolls a single gem. The strike still powers the rig either way.
  const chance = actionSuccessChance(db, userId, action, choiceId)
  const hit = chance >= 1 || rand() < chance
  let struckGained: Cost[] = []
  if (hit) struckGained = grantItems(db, bus, userId, actionId, actionRoll(action, choiceId, rand))
  const struckSpent = actionConsumes(action, choiceId)
  if (struckSpent.length) consumeItems(db, bus, userId, struckSpent)

  const powered = extendRig({ ...current, settledAt: now, choice: choiceId ?? '' }, now)
  setRigState(db, userId, actionId, powered)
  addGatherLog(db, userId, actionId, powered.completions)

  // The drill always powers its own machine: if that makes a third run live, the
  // cap stops the rig closest to finishing (§13.5.1). `report.rigs` already carries
  // the post-settle (and post-cap) states, so no second query is needed.
  report.rigs.set(actionId, powered)
  const stopped = capLiveRigs(report.rigs, now, [actionId])
  for (const id of stopped) setRigState(db, userId, id, report.rigs.get(id)!)
  const stoppedRig = stopped[0] ? ACTION_BY_ID.get(stopped[0]) : undefined

  const bonus = aggregateBonuses(db, userId)
  return {
    gained: mergeCosts(report.gained, struckGained),
    consumed: mergeCosts(report.spent, struckSpent),
    idle: idleView(powered, action, now, bonus.yield(actionId) + bonus.double(actionId)),
    xp: settledXp,
    rigsRunning: liveRigCount(report.rigs, now),
    maxLiveRigs: MAX_LIVE_RIGS,
    stoppedRig: stoppedRig
      ? { actionId: stoppedRig.id, name: stoppedRig.name, skillId: stoppedRig.skillId }
      : null,
  }
}

/**
 * Stop a running rig on purpose (§13.5.1): settle its run up to now (so no work is
 * lost), then let it fall still so its slot frees for another machine. The player's
 * escape hatch from the live-rig cap — the UI confirms before calling this.
 * Returns false when the action has no live run.
 */
export function stopRig(
  db: Db,
  bus: EventBus,
  userId: string,
  actionId: string,
  now = Date.now(),
): boolean {
  const report = settleAll(db, bus, userId, now)
  const rig = report.rigs.get(actionId)
  if (!rig || rig.runEndsAt <= now) return false
  setRigState(db, userId, actionId, { ...rig, runEndsAt: 0, settledAt: now })
  return true
}

/** Remember which recipe a choose-input action's rig runs (§13.5.3.1). */
export function setRigChoice(db: Db, userId: string, actionId: string, choiceId: string): boolean {
  const action = ACTION_BY_ID.get(actionId)
  if (!action?.choices?.length) return false
  if (!action.choices.some((c) => c.id === choiceId)) return false
  const current = getRigState(db, userId, actionId) ?? newRig()
  setRigState(db, userId, actionId, { ...current, choice: choiceId })
  return true
}

function toCosts(map: Record<string, number>): Cost[] {
  return Object.entries(map)
    .filter(([, n]) => n > 0)
    .map(([item, count]) => ({ item, count }))
}

function mergeCosts(...lists: Cost[][]): Cost[] {
  const out = new Map<string, number>()
  for (const list of lists) for (const c of list) out.set(c.item, (out.get(c.item) ?? 0) + c.count)
  return [...out].map(([item, count]) => ({ item, count })).filter((c) => c.count > 0)
}

export interface ActionProgress {
  actionId: string
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
}

/** Per-action XP + level (actions never trained are absent — callers default to 1). */
export function actionProgressView(db: Db, userId: string): Map<string, ActionProgress> {
  return new Map(
    listActionProgress(db, userId).map((r) => [
      r.actionId,
      { actionId: r.actionId, xp: r.xp, ...actionLevelInfo(r.xp) },
    ]),
  )
}

/**
 * Per-profession summary with its **derived** level (the sum of its actions). The
 * profession has no XP bar of its own, so `progress` is the average of its
 * actions' progress toward their next level.
 */
export function skillSummaries(db: Db, userId: string) {
  const byAction = actionProgressView(db, userId)
  return SKILLS.map((s) => {
    const acts = actionsForSkill(s.id)
    const rows = acts.map((a) => byAction.get(a.id))
    // the mean of the action levels: reads out of 100, and a new action lowers it
    const level = acts.length
      ? Math.round(rows.reduce((n, r) => n + (r?.level ?? 1), 0) / acts.length)
      : 1
    const xp = rows.reduce((n, r) => n + (r?.xp ?? 0), 0)
    const progress = acts.length
      ? rows.reduce((n, r) => n + (r?.progress ?? 0), 0) / acts.length
      : 0
    return { skillId: s.id, xp, level, intoLevel: 0, forNext: 0, progress }
  })
}

/**
 * The **account level** (docs/DESIGN.md §13): the mean of every profession's own
 * level, so it reads out of 100 exactly like a profession does — "percent
 * complete", 1 at the start and 100 when every action is maxed. It is *derived*,
 * never stored: it climbs as your professions climb (both the drills and the idle
 * rigs feed them) and **drops when a new profession or action is added**, because
 * the average gains a denominator you have not trained yet. That is intended.
 */
export function accountLevel(db: Db, userId: string): { level: number; progress: number } {
  const profs = skillSummaries(db, userId)
  if (!profs.length) return { level: 1, progress: 0 }
  const mean = profs.reduce((n, p) => n + p.level, 0) / profs.length
  const progress = profs.reduce((n, p) => n + p.progress, 0) / profs.length
  return { level: Math.min(100, Math.max(1, Math.round(mean))), progress }
}

export function inventoryView(db: Db, userId: string) {
  const counts = new Map(listInventory(db, userId).map((r) => [r.itemId, r.count]))
  return ITEMS.map((i) => ({ itemId: i.id, count: counts.get(i.id) ?? 0 }))
}

export interface BandGate {
  id: BandId
  name: string
  /** the level this action asks for */
  level: number
  /** the player's current band score */
  current: number
}

export interface ActionState {
  unlocked: boolean
  missingUnlocks: UnlockReq[]
  affordable: boolean
  missing: Cost[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
  /** the band this action belongs to and the level it unlocks at, or null */
  band: BandGate | null
  /** cross-band gates not yet met (e.g. iron needs Bronze 40) */
  missingBands: BandGate[]
}

export function actionState(db: Db, userId: string, action: ActionDef, choiceId?: string): ActionState {
  const missingUnlocksList = missingUnlocks(action, (s) => skillLevelOf(db, userId, s))
  // Cost depends on the chosen recipe (prospect this ore, cut that gem).
  const consumes = actionConsumes(action, choiceId)
  const missing = consumes.filter((c) => getItemCount(db, userId, c.item) < c.count)
  const bandLevels = bandLevelMap(db, userId)
  let band: BandGate | null = null
  const missingBands: BandGate[] = []
  if (action.band) {
    const def = BAND_BY_ID.get(action.band)
    band = {
      id: action.band,
      name: def?.name ?? action.band,
      level: action.bandLevel ?? 1,
      current: bandLevels.get(action.band) ?? 1,
    }
    // A tier's whole band stays shut until the tier below reached 40 (§13.5.3).
    if (def?.after) {
      const current = bandLevels.get(def.after.band) ?? 1
      if (current < def.after.level) {
        missingBands.push({
          id: def.after.band,
          name: BAND_BY_ID.get(def.after.band)?.name ?? def.after.band,
          level: def.after.level,
          current,
        })
      }
    }
  }
  let equipOk = true
  let equipMissing: { slot: string; tag: string } | null = null
  if (action.equip) {
    const eq = listEquipment(db, userId).find((e) => e.slot === action.equip!.slot)
    const item = eq ? ITEM_BY_ID.get(eq.itemId) : undefined
    equipOk = Boolean(item?.tags?.includes(action.equip.tag))
    if (!equipOk) equipMissing = action.equip
  }
  const bandOk = !band || band.current >= band.level
  return {
    unlocked: missingUnlocksList.length === 0 && bandOk && missingBands.length === 0 && equipOk,
    missingUnlocks: missingUnlocksList,
    affordable: missing.length === 0,
    missing,
    equipOk,
    equipMissing,
    band,
    missingBands,
  }
}

/**
 * The chance an action actually yields its output, at the player's current level
 * (§13.5.3.1). Prospecting always consumes its ore, so a miss is a real cost — the
 * odds rise with the action's level, so skill beats the gamble.
 */
export function actionSuccessChance(
  db: Db,
  userId: string,
  action: ActionDef,
  choiceId?: string,
): number {
  const level = actionLevelOf(db, userId, action.id)
  return actionOdds(action, choiceId, level)
}

/** The items an action yields — fixed, or the expected value of its gem table. */
export function actionProduces(action: ActionDef, choiceId?: string): Cost[] {
  return actionExpected(action, choiceId)
}

// --- equipment ---------------------------------------------------------------

export interface GearRequirementView extends MissingRequirement {
  /** Human skill name, e.g. `Defence`. */
  name: string
}

export interface GearInstanceView {
  id: string
  itemId: string
  slot: Slot
  quality: GearQuality
  stats: GearStats
  armour: number
  power: number
  gearScore: number
  equipped: boolean
  /** Enchant tokens on this piece: a band id, or `gem:<type>` (§13.5.3.1). */
  enchant: string[]
  /** Stat levels needed to wear this piece. */
  requirements: Partial<Record<SkillId, number>>
  /** Requirements the player does not meet yet (empty when wearable). */
  missing: GearRequirementView[]
}

/** Adds the human skill name to a missing requirement for the inventory UI. */
function requirementView(missing: MissingRequirement[]): GearRequirementView[] {
  return missing.map((m) => ({ ...m, name: SKILL_BY_ID.get(m.skill)?.name ?? m.skill }))
}

/**
 * Older equipment rows predate gear instances. Give every worn piece a base
 * instance once, so the paper doll and saved sets can show its stats.
 */
export function materializeWornGear(db: Db, userId: string): void {
  for (const row of listEquipment(db, userId)) {
    if (row.instanceId) continue
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item?.slot) continue
    const id = baseGearInstance(db, userId, item)
    setEquipment(db, userId, row.slot, row.itemId, id)
  }
}

/** Every crafted piece the player owns, with its rolled stats and wear state. */
export function gearView(db: Db, userId: string): GearInstanceView[] {
  materializeWornGear(db, userId)
  const worn = new Set(
    listEquipment(db, userId)
      .map((e) => e.instanceId)
      .filter((id): id is string => Boolean(id)),
  )
  const levelOf = (skill: SkillId) => skillLevelOf(db, userId, skill)
  return listGearInstances(db, userId).map((row) => {
    const stats = parseStats(row.statsJson)
    const item = ITEM_BY_ID.get(row.itemId)
    return {
      id: row.id,
      itemId: row.itemId,
      slot: row.slot as Slot,
      quality: row.quality as GearQuality,
      stats,
      armour: row.armour,
      power: row.power,
      gearScore: gearScore(stats, row.armour, row.power),
      equipped: worn.has(row.id),
      enchant: parseEnchants(row.enchantJson),
      requirements: item ? itemRequirements(item) : {},
      missing: item ? requirementView(meetsRequirements(item, levelOf).missing) : [],
    }
  })
}

/** The first unequipped instance of an item, if one exists. */
function freeInstanceFor(db: Db, userId: string, itemId: string): string | undefined {
  const worn = new Set(
    listEquipment(db, userId)
      .map((e) => e.instanceId)
      .filter((id): id is string => Boolean(id)),
  )
  return listGearInstances(db, userId).find((g) => g.itemId === itemId && !worn.has(g.id))?.id
}

/** Creates a crafted instance for an item, rolling its quality and affixes. */
export function craftGearInstance(
  db: Db,
  userId: string,
  item: ItemDef,
  rand: () => number = Math.random,
): string {
  const roll = rollGearStats(item, rand)
  return addGearInstance(db, {
    userId,
    itemId: item.id,
    slot: item.slot!,
    quality: roll.quality,
    statsJson: JSON.stringify(roll.stats),
    armour: roll.armour,
    power: roll.power,
  })
}

/**
 * A deterministic common instance from an item's base stats. Used when an old
 * bank stack (or a test fixture) equips a piece that was never rolled.
 */
export function baseGearInstance(db: Db, userId: string, item: ItemDef): string {
  return addGearInstance(db, {
    userId,
    itemId: item.id,
    slot: item.slot!,
    quality: 'common',
    statsJson: JSON.stringify(statsOf(item)),
    armour: item.armour ?? 0,
    power: item.power ?? 0,
  })
}

/** Rolls one instance per piece produced. Non-equipment items are ignored. */
export function recordGearCrafts(
  db: Db,
  userId: string,
  itemId: string,
  count: number,
  rand: () => number = Math.random,
): void {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot || item.tier !== 'equipment' || count <= 0) return
  for (let i = 0; i < count; i++) craftGearInstance(db, userId, item, rand)
}

/**
 * Equips a piece. Crafted gear equips by instance so its rolled stats follow it;
 * legacy gear (or a bare item id) equips the first free instance, or creates one
 * from the base definition. The inventory count stays as "pieces owned".
 */
export function equipItem(
  db: Db,
  bus: EventBus,
  userId: string,
  itemId: string,
  instanceId?: string,
  targetSlot?: string,
): { ok: boolean; error?: string; instanceId?: string; missing?: GearRequirementView[] } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item?.slot) return { ok: false, error: 'not equippable' }

  // RuneScape-style gate: the piece's stat requirements must be met first.
  const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill))
  if (!gate.ok) {
    const missing = requirementView(gate.missing)
    return {
      ok: false,
      error: `requires ${missing.map((m) => `${m.name} ${m.level}`).join(', ')}`,
      missing,
    }
  }

  const slot =
    targetSlot && slotFamily(item.slot).includes(targetSlot as Slot)
      ? (targetSlot as Slot)
      : item.slot

  let instance = instanceId ? getGearInstance(db, userId, instanceId) : undefined
  if (instance && instance.itemId !== itemId) return { ok: false, error: 'wrong item' }
  if (!instance) {
    const owned = listGearInstances(db, userId).filter((g) => g.itemId === itemId)
    if (owned.length > 0) {
      const free = freeInstanceFor(db, userId, itemId)
      if (!free) return { ok: false, error: 'every piece is already worn' }
      instance = getGearInstance(db, userId, free)
    } else {
      if (getItemCount(db, userId, itemId) < 1) return { ok: false, error: 'not in your bank' }
      const id = baseGearInstance(db, userId, item)
      instance = getGearInstance(db, userId, id)
    }
  }

  setEquipment(db, userId, slot, itemId, instance?.id ?? null)
  bus.emit('item.equipped', { userId, itemId, slot })
  return { ok: true, instanceId: instance?.id }
}

export function unequipItem(db: Db, userId: string, slot: string): void {
  const normalized = slot === 'weapon' ? 'mainHand' : slot === 'body' ? 'chest' : slot
  setEquipment(db, userId, normalized, null)
}

// --- saved gear sets ---------------------------------------------------------

export interface GearSetView {
  id: string
  name: string
  combatStyle: CombatStyle
  slots: Record<string, { itemId: string; instanceId: string | null }>
  createdAt: number
  updatedAt: number
}

function parseSetSlots(
  json: string,
): Record<string, { itemId: string; instanceId: string | null }> {
  try {
    return JSON.parse(json) as Record<string, { itemId: string; instanceId: string | null }>
  } catch {
    return {}
  }
}

export function gearSetsView(db: Db, userId: string): GearSetView[] {
  return listGearSets(db, userId).map((row) => ({
    id: row.id,
    name: row.name,
    combatStyle: row.combatStyle as CombatStyle,
    slots: parseSetSlots(row.slotsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

/** Snapshots the current loadout under a name. */
export function saveGearSet(
  db: Db,
  userId: string,
  name: string,
  combatStyle?: CombatStyle,
): GearSetView {
  const slots: GearSetView['slots'] = {}
  for (const e of listEquipment(db, userId)) {
    slots[e.slot] = { itemId: e.itemId, instanceId: e.instanceId ?? null }
  }
  const style = combatStyle ?? getPlayerCombat(db, userId).combatStyle
  const id = addGearSet(db, { userId, name, combatStyle: style, slotsJson: JSON.stringify(slots) })
  return gearSetsView(db, userId).find((s) => s.id === id)!
}

/** A saved-set piece the player cannot wear yet. */
export interface GearSetSkip {
  slot: string
  itemId: string
  name: string
  missing: GearRequirementView[]
}

/** Swaps the worn gear to a saved set. Unknown/deleted instances are skipped. */
export function applyGearSet(
  db: Db,
  bus: EventBus,
  userId: string,
  setId: string,
): { ok: boolean; error?: string; skipped: GearSetSkip[] } {
  const set = gearSetsView(db, userId).find((s) => s.id === setId)
  if (!set) return { ok: false, error: 'set not found', skipped: [] }
  const skipped: GearSetSkip[] = []
  for (const slot of SLOTS) {
    const entry = set.slots[slot.id]
    if (!entry) {
      setEquipment(db, userId, slot.id, null)
      continue
    }
    const item = ITEM_BY_ID.get(entry.itemId)
    if (item) {
      const gate = meetsRequirements(item, (skill) => skillLevelOf(db, userId, skill))
      if (!gate.ok) {
        // Keep whatever is worn: the rest of the set still goes on.
        skipped.push({
          slot: slot.id,
          itemId: entry.itemId,
          name: item.name,
          missing: requirementView(gate.missing),
        })
        continue
      }
    }
    const instance = entry.instanceId ? getGearInstance(db, userId, entry.instanceId) : undefined
    if (instance) {
      setEquipment(db, userId, slot.id, instance.itemId, instance.id)
      bus.emit('item.equipped', { userId, itemId: instance.itemId, slot: slot.id })
    } else if (ITEM_BY_ID.has(entry.itemId) && getItemCount(db, userId, entry.itemId) > 0) {
      setEquipment(db, userId, slot.id, entry.itemId, null)
    }
  }
  return { ok: true, skipped }
}

export function removeGearSet(db: Db, userId: string, setId: string): void {
  deleteGearSet(db, userId, setId)
}

/** Removes a single crafted piece (not while worn). */
export function discardGearInstance(
  db: Db,
  userId: string,
  instanceId: string,
): { ok: boolean; error?: string } {
  const worn = listEquipment(db, userId).some((e) => e.instanceId === instanceId)
  if (worn) return { ok: false, error: 'unequip it first' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  deleteGearInstance(db, userId, instanceId)
  addItems(db, userId, instance.itemId, -1)
  return { ok: true }
}

/** Materials returned by salvaging a piece, by armour family. */
const SALVAGE_MATERIAL: Record<ArmourType, string> = {
  plate: 'iron_ore',
  leather: 'hide',
  cloth: 'cloth',
  jewelry: 'cut_gem',
}

/** Salvage yield by quality: better pieces break into more material. */
const SALVAGE_YIELD: Record<GearQuality, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 5,
}

/**
 * Breaks a crafted piece back into crafting materials. The piece must be
 * unequipped. Higher quality rolls return more material.
 */
export function salvageGearInstance(
  db: Db,
  bus: EventBus,
  userId: string,
  instanceId: string,
): { ok: boolean; error?: string; materials?: Cost[] } {
  const worn = listEquipment(db, userId).some((e) => e.instanceId === instanceId)
  if (worn) return { ok: false, error: 'unequip it first' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  const item = ITEM_BY_ID.get(instance.itemId)
  if (!item) return { ok: false, error: 'unknown item' }
  const material = SALVAGE_MATERIAL[item.armourType ?? 'plate']
  const count = SALVAGE_YIELD[instance.quality as GearQuality] ?? 1
  const materials: Cost[] = [{ item: material, count }]
  // Deep salvage also yields the band's reagent (§13.5.3): the feedstock
  // Enchanting spends to put that band's signature stat on a higher-tier piece.
  const band = bandForItem(item)
  if (band) materials.push({ item: band.reagent, count })
  deleteGearInstance(db, userId, instanceId)
  addItems(db, userId, instance.itemId, -1)
  for (const m of materials) {
    addItems(db, userId, m.item, m.count)
    bus.emit('item.gained', {
      userId,
      itemId: m.item,
      count: m.count,
      total: getItemCount(db, userId, m.item),
    })
  }
  return { ok: true, materials }
}

/**
 * Distill an item (§13.5.3.2): burn it to learn from it and pull out its family
 * essence. Enchanting XP is a **percentage of the item's coin value**, so an endgame
 * piece levels it faster but never instantly.
 */
export function distillItem(
  db: Db,
  bus: EventBus,
  userId: string,
  itemId: string,
  count = 1,
): { ok: boolean; error?: string; xp?: number; essence?: string } {
  const item = ITEM_BY_ID.get(itemId)
  if (!item) return { ok: false, error: 'unknown item' }
  const n = Math.max(1, Math.floor(count))
  if (getItemCount(db, userId, itemId) < n) return { ok: false, error: 'not in your bank' }
  consumeItems(db, bus, userId, [{ item: itemId, count: n }])
  const xp = Math.max(1, Math.round(itemValue(item) * DISTILL_XP_PER_VALUE)) * n
  awardActionXp(db, bus, userId, 'distill', xp)
  const essence = essenceId(essenceFamily(item))
  addItems(db, userId, essence, n)
  bus.emit('item.gained', {
    userId,
    itemId: essence,
    count: n,
    total: getItemCount(db, userId, essence),
  })
  return { ok: true, xp, essence }
}

/**
 * Apply an enchant to a crafted piece (§13.5.3.2). The enchant fits the piece's slot,
 * needs its Enchanting level, and costs its own essence reagents. It grants **no** XP
 * — the training is Distill; this is the payoff. One enchant per piece (replace).
 */
export function applyEnchant(
  db: Db,
  bus: EventBus,
  userId: string,
  instanceId: string,
  enchantId: string,
): { ok: boolean; error?: string; enchantingLevel?: number } {
  const def = ENCHANT_BY_ID.get(enchantId)
  if (!def) return { ok: false, error: 'unknown enchant' }
  const instance = getGearInstance(db, userId, instanceId)
  if (!instance) return { ok: false, error: 'not found' }
  const item = ITEM_BY_ID.get(instance.itemId)
  if (!item?.slot || !(def.slot === item.slot || slotFamily(def.slot).includes(item.slot))) {
    return { ok: false, error: `${def.name} does not fit ${item?.slot ?? 'that piece'}` }
  }
  const level = skillLevelOf(db, userId, 'enchanting')
  if (level < def.level) {
    return { ok: false, error: `requires Enchanting ${def.level}`, enchantingLevel: level }
  }
  const missing = def.reagents.filter((r) => getItemCount(db, userId, r.item) < r.count)
  if (missing.length) {
    return { ok: false, error: `needs ${missing.map((m) => m.item).join(', ')}` }
  }
  consumeItems(db, bus, userId, def.reagents)
  setGearInstanceEnchant(db, userId, instanceId, JSON.stringify([def.id]))
  bus.emit('item.enchanted', { userId, instanceId, band: def.id })
  return { ok: true }
}

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

/** The player's effective combat level, used to scale monsters. */
export function combatLevel(db: Db, userId: string): number {
  return Math.max(
    skillLevelOf(db, userId, 'attack'),
    skillLevelOf(db, userId, 'strength'),
    skillLevelOf(db, userId, 'ranged'),
    skillLevelOf(db, userId, 'magic'),
    skillLevelOf(db, userId, 'defence'),
    skillLevelOf(db, userId, 'constitution'),
  )
}

/** The active set bonuses for the current loadout (without the full combat maths). */
export function activeSetBonusesFor(db: Db, userId: string): ActiveSetBonus[] {
  materializeWornGear(db, userId)
  const counts: Partial<Record<ArmourType, number>> = {}
  for (const row of listEquipment(db, userId)) {
    const item = ITEM_BY_ID.get(row.itemId)
    if (item?.armourType) {
      counts[item.armourType] = (counts[item.armourType] ?? 0) + 1
    }
  }
  return activeSetBonuses(counts)
}

/**
 * The player's combat numbers for their current loadout. The equipped weapon
 * decides the trained skill (sword → Strength, bow → Ranged, staff → Magic), so
 * fights always use what you have — no per-monster choice. Every worn piece
 * contributes its rolled stats, armour and power.
 */
export function getPlayerCombat(db: Db, userId: string): PlayerCombat {
  materializeWornGear(db, userId)
  const b = aggregateBonuses(db, userId)
  const eq = listEquipment(db, userId)
  const weapon = eq.find((e) => e.slot === 'mainHand' || e.slot === 'weapon')
  const weaponItem = weapon ? ITEM_BY_ID.get(weapon.itemId) : undefined
  const skill = weaponSkill(weaponItem?.tags)
  const combatStyle = combatStyleForTags(weaponItem?.tags)

  let stats = emptyStats()
  let totalPower = 0
  let totalArmour = 0
  const armourCounts: Partial<Record<ArmourType, number>> = {}
  for (const row of eq) {
    const item = ITEM_BY_ID.get(row.itemId)
    if (!item) continue
    if (item.armourType) {
      armourCounts[item.armourType] = (armourCounts[item.armourType] ?? 0) + 1
    }
    const instance = row.instanceId ? getGearInstance(db, userId, row.instanceId) : undefined
    stats = addStats(stats, instance ? parseStats(instance.statsJson) : statsOf(item))
    // An enchant adds its stat points straight onto the piece (§13.5.3.2).
    const def = instance ? enchantOf(instance) : undefined
    if (def) stats = { ...stats, [def.stat]: stats[def.stat] + def.value }
    totalPower += instance?.power ?? item.power ?? 0
    totalArmour += instance?.armour ?? item.armour ?? 0
  }

  const setBonuses = activeSetBonuses(armourCounts)
  const boosted = applySetBonuses(stats, totalArmour, totalPower, setBonuses)
  stats = boosted.stats
  totalArmour = boosted.armour
  totalPower = boosted.power

  const derived = deriveStats(stats, skill)
  // Tier bands grant an account-wide passive (§13.5.3), on top of the rolled and
  // enchanted piece stats.
  const band = bandBonusesFor(db, userId)
  const crit = derived.crit + band.crit
  const haste = derived.haste + band.haste
  const mastery = derived.mastery + band.mastery
  const lifesteal = band.lifesteal
  const stamina = Math.round(stats.stamina + band.stamina)
  stats = { ...stats, stamina }
  return {
    skill,
    combatStyle,
    maxHp: playerMaxHp(skillLevelOf(db, userId, 'constitution'), b.hp, totalArmour, stamina),
    power: playerPower(
      skillLevelOf(db, userId, skill),
      totalPower,
      b.damage,
      derived.primary,
      mastery,
    ),
    armour: totalArmour,
    weaponPower: totalPower,
    bodyArmour: totalArmour,
    stats,
    stamina,
    crit,
    haste,
    mastery,
    lifesteal,
    gearScore: gearScore(stats, totalArmour, totalPower),
    setBonuses,
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

export function startEncounter(
  db: Db,
  bus: EventBus,
  userId: string,
  monsterId: string,
):
  | {
      ok: true
      monster: MonsterDef
      encounter: {
        monsterId: string
        monsterHp: number
        monsterMaxHp: number
        monsterDamage: number
        monsterLevel: number
        xpReward: number
        playerHp: number
        playerMaxHp: number
      }
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
  const pc = getPlayerCombat(db, userId)
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

  // HP carries between fights: resume from what's left, clamped to this fight's
  // max HP (which a restore potion may have raised).
  const startHp = currentHp(db, userId, maxHp)

  // Monsters are **fixed** (docs §13.5): their numbers never move, so the buffs a
  // player stacks read as power, not as a modifier that cancels itself out.
  // Progression is a ladder — you climb to higher monsters, and the top is tuned
  // against a fully stacked player.
  upsertEncounter(db, userId, {
    monsterId,
    monsterHp: m.hp,
    playerHp: startHp,
    playerMaxHp: maxHp,
    monsterMaxHp: m.hp,
    monsterDamage: m.damage,
    monsterLevel: m.level,
    xpReward: m.xp,
    powerBonus,
    potionId,
    foodEaten: 0,
    totalDamage: 0,
    xpEarned: 0,
  })
  return {
    ok: true,
    monster: m,
    encounter: {
      monsterId,
      monsterHp: m.hp,
      monsterMaxHp: m.hp,
      monsterDamage: m.damage,
      monsterLevel: m.level,
      xpReward: m.xp,
      playerHp: startHp,
      playerMaxHp: maxHp,
    },
    drank,
  }
}

export function grantExactItems(db: Db, bus: EventBus, userId: string, costs: Cost[]): void {
  for (const c of costs) {
    if (c.count <= 0) continue
    addItems(db, userId, c.item, c.count)
    recordGearCrafts(db, userId, c.item, c.count)
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
  /** the combat profession the equipped weapon trains */
  skill: SkillId
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
  const pc = getPlayerCombat(db, userId)
  const maxHp = enc.playerMaxHp || pc.maxHp
  const monsterMaxHp = enc.monsterMaxHp || m.hp
  const monsterDamage = enc.monsterDamage || m.damage
  const monsterLevel = enc.monsterLevel || m.level
  const xpReward = enc.xpReward || m.xp
  let monsterHp = enc.monsterHp
  let playerHp = enc.playerHp
  let foodEaten = enc.foodEaten
  let damage = 0
  let crit = false
  let haste = false
  let playerDamage = 0
  let xp = 0
  let defenceXp = 0
  let constitutionXp = 0
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
    const base = pc.power * (1 + enc.powerBonus)
    crit = pc.crit > 0 && rand() < pc.crit
    haste = pc.haste > 0 && rand() < pc.haste
    const multiplier = (crit ? 1.75 : 1) * (1 + pc.mastery) * (haste ? 1.5 : 1)
    damage = Math.max(1, Math.round(base * multiplier))
    monsterHp = Math.max(0, monsterHp - damage)
    // Iron bands/enchants return a slice of the damage dealt as HP.
    if (pc.lifesteal > 0) {
      const heal = Math.round(damage * pc.lifesteal)
      if (heal > 0) playerHp = Math.min(maxHp, playerHp + heal)
    }
    xp = Math.max(1, Math.round(xpReward / 4))
    bus.emit('combat.hit', { userId, monsterId: m.id, damage, monsterHp, crit, haste })
  }

  // The monster swings on every exchange — whether you strike it, miss, or run
  // out of time. A correct answer only adds your own hit on top. Weathering the
  // blow trains Defence and Constitution; XP scales with what actually landed
  // (armour reduces both damage and training).
  playerDamage = incomingDamage(monsterDamage, pc.armour)
  playerHp = Math.max(0, playerHp - playerDamage)
  defenceXp = Math.max(1, playerDamage)
  constitutionXp = Math.max(1, playerDamage)

  let outcome: HitOutcome['outcome'] = 'ongoing'
  if (monsterHp <= 0) {
    outcome = 'won'
    xp += xpReward
    drops.push(...rollDrops(m.drops, aggregateBonuses(db, userId).drop, rand))
  } else if (playerHp <= 0) {
    outcome = 'lost'
  }

  const awards = [
    xp > 0 ? awardActionXp(db, bus, userId, primaryActionOf(pc.skill), xp) : null,
    defenceXp > 0 ? awardActionXp(db, bus, userId, primaryActionOf('defence'), defenceXp) : null,
    constitutionXp > 0
      ? awardActionXp(db, bus, userId, primaryActionOf('constitution'), constitutionXp)
      : null,
  ]
  const talentUnlocked = awards.find((a) => a?.talentUnlocked)?.talentUnlocked ?? null

  // HP persists between fights: write the surviving value back. A defeat leaves
  // you at a sliver, not a free full heal — you have to eat to recover.
  setPlayerHp(db, userId, outcome === 'lost' ? DEFEAT_HP : Math.max(DEFEAT_HP, playerHp))

  if (outcome === 'won') {
    grantExactItems(db, bus, userId, drops)
    awardXp(db, bus, userId, xpReward, 'combat', m.id)
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
      monsterMaxHp,
      monsterDamage,
      monsterLevel,
      xpReward,
      powerBonus: enc.powerBonus,
      potionId: enc.potionId,
      foodEaten,
      totalDamage: enc.totalDamage + damage,
      xpEarned: enc.xpEarned + xp,
    })
  }

  return {
    correct,
    skill: pc.skill,
    damage,
    crit,
    haste,
    monsterHp,
    monsterMaxHp,
    monsterDamage,
    monsterLevel,
    playerDamage,
    playerHp,
    playerMaxHp: maxHp,
    outcome,
    drops,
    xp,
    defenceXp,
    constitutionXp,
    ate,
    talentUnlocked,
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

/**
 * Advances a card's FSRS-6 schedule after a review, appends to the review log
 * and emits `srs.updated`. `source` records which surface fed the schedule.
 */
export function recordReview(
  db: Db,
  bus: EventBus,
  userId: string,
  cardId: string,
  score: number,
  correct: boolean,
  opts: { source?: string } = {},
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
  const desiredRetention = desiredRetentionFor(db, userId)
  const elapsedDays =
    prev.state === 'new' || prev.lastReviewAt == null
      ? 0
      : Math.max(0, (now - prev.lastReviewAt) / DAY_MS)
  const { state, intervalDays, dueAt } = schedule(prev, rating, now, {
    desiredRetention,
    learningSteps: readStudyPrefs(db, userId).learningSteps,
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
  addSrsReview(db, {
    userId,
    cardId,
    rating,
    stateBefore: prev.state,
    stateAfter: state.state,
    stabilityBefore: prev.stability,
    stabilityAfter: state.stability,
    difficultyBefore: prev.difficulty,
    difficultyAfter: state.difficulty,
    intervalDays,
    elapsedDays,
    desiredRetention,
    dueAt,
    source: opts.source ?? 'practice',
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

/** The target-language words a learner currently knows (learned cards). */
export function knownWords(db: Db, userId: string): Set<string> {
  const srsMap = srsStateMap(db, userId)
  const known = new Set<string>()
  for (const c of listCards(db, userId)) {
    if (isLearned(srsMap.get(c.id))) known.add(c.back)
  }
  return known
}

export interface StudyBudget {
  /** Effective limits; 0 means unlimited. */
  newPerDay: number
  maxReviewsPerDay: number
  /** How much of each budget is already spent today (UTC). */
  newToday: number
  reviewsToday: number
  /** What is left under the budget (the available count when unlimited). */
  newRemaining: number
  reviewsRemaining: number
  newUnlimited: boolean
  reviewsUnlimited: boolean
}

/** Start of the UTC day containing `ts`, in epoch ms (matches the streak day). */
export function startOfUtcDay(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Today's study budget: how many new cards and reviews are left (docs/DESIGN.md
 * §13.6). Anki-style daily limits bound a day's work; the learner can raise
 * today's allowance with "study more".
 */
export function studyBudget(db: Db, userId: string, now: number = Date.now()): StudyBudget {
  const prefs = readStudyPrefs(db, userId)
  const extra = readDailyExtra(db, userId, now)
  const { newCards, reviews } = dailyReviewCounts(db, userId, startOfUtcDay(now))
  const ids = listCards(db, userId).map((c) => c.id)
  const map = srsStateMap(db, userId)
  const newPerDay = prefs.newPerDay <= 0 ? 0 : prefs.newPerDay + extra.newExtra
  const maxReviewsPerDay =
    prefs.maxReviewsPerDay <= 0 ? 0 : prefs.maxReviewsPerDay + extra.reviewsExtra
  const newUnlimited = newPerDay === 0
  const reviewsUnlimited = maxReviewsPerDay === 0
  return {
    newPerDay,
    maxReviewsPerDay,
    newToday: newCards,
    reviewsToday: reviews,
    newRemaining: newUnlimited ? countNew(ids, map) : Math.max(0, newPerDay - newCards),
    reviewsRemaining: reviewsUnlimited
      ? countDue(ids, map, now)
      : Math.max(0, maxReviewsPerDay - reviews),
    newUnlimited,
    reviewsUnlimited,
  }
}

export interface SrsStats {
  total: number
  learned: number
  due: number
  new: number
  budget: StudyBudget
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
    budget: studyBudget(db, userId, now),
  }
}

/** The guided path: each deck split into lessons with completion state. */
export function curriculumView(db: Db, userId: string) {
  const decks = listDecks(db, userId)
  const srsMap = srsStateMap(db, userId)
  const completed = new Set(listLessonProgress(db, userId).map((r) => r.lessonId))
  const now = Date.now()

  return decks.map((d) => {
    const cards = listCards(db, userId, d.id)
    const ids = cards.map((c) => c.id)
    const lessons = buildLessons(deckKey(d), stepCards(cards)).map((l) => {
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
      description: d.description,
      settings: publicDeckSettings(d.settings),
      // How many source words are still unbuilt (an interrupted import), so the
      // UI can offer to finish it. Undefined when the deck has no stored list.
      remaining: d.settings.words
        ? Math.max(0, d.settings.words.length - (d.settings.cursor ?? 0))
        : undefined,
      cardCount: Number(d.cardCount),
      learned: ids.filter((id) => isLearned(srsMap.get(id))).length,
      due: countDue(ids, srsMap, now),
      lessons,
    }
  })
}

/** Maps stored cards to the shape the curriculum builder needs. */
function stepCards(cards: ReturnType<typeof listCards>) {
  return cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    reading: cardReading(c),
    step: typeof c.payload?.step === 'number' ? c.payload.step : undefined,
  }))
}

/** The reading a learner sees: Zhuyin for Chinese, kana for Japanese. */
function cardReading(c: { targetLang: string; readings: Record<string, string> }): string {
  const r = c.readings
  if (c.targetLang === 'ja') return r.kana || ''
  if (c.targetLang === 'zh') return r.zhuyin || (r.pinyin ? pinyinToZhuyin(r.pinyin) : '')
  return Object.values(r).find(Boolean) ?? ''
}

/** Marks a lesson complete when every card in it has been learned. */
export function checkLessonCompletion(
  db: Db,
  bus: EventBus,
  userId: string,
  lessonId: string,
): boolean {
  const sep = lessonId.lastIndexOf(':')
  if (sep <= 0) return false
  const key = lessonId.slice(0, sep)
  const index = Number(lessonId.slice(sep + 1)) - 1
  if (!key || !Number.isFinite(index) || index < 0) return false
  const deck = listDecks(db, userId).find((d) => d.level === key || d.id === key)
  if (!deck) return false
  const cards = listCards(db, userId, deck.id)
  const lesson = buildLessons(key, stepCards(cards))[index]
  if (!lesson || lesson.cardIds.length === 0) return false
  const srsMap = srsStateMap(db, userId)
  const done = lesson.cardIds.every((id) => isLearned(srsMap.get(id)))
  if (!done) return false
  // Only a transition counts: reviewing a lesson that was finished days ago is
  // not "lesson complete" again (the practice queue interleaves steps now).
  const known = listLessonProgress(db, userId).some((p) => p.lessonId === lessonId)
  if (known) return false
  completeLesson(db, userId, lessonId)
  bus.emit('lesson.completed', { userId, lessonId })
  return true
}
