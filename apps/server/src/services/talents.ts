/** Choosing a talent at a milestone, and the talent board (docs/DESIGN.md §13.5). */

import { addTalent, listTalents, replaceTalent } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { ACTION_MAX_LEVEL, SKILL_BY_ID, SKILLS, type SkillDef, type SkillId } from '../game/skills'
import {
  MASTERY_MILESTONES,
  SYNERGY,
  masteryOptions,
  optionsFor,
  parseTalentId,
  resolveTalents,
  talentMilestones,
  talentOptions,
  type TalentDef,
} from '../game/talents'
import { skillLevelOf } from './progress'

interface TalentRow {
  talentId: string
  skillId: string
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
  if (!existing) return insertTalent(db, bus, userId, option)
  if (existing.talentId !== option.id) replaceExisting(db, bus, userId, option, existing.talentId)
  return { ok: true, talent: option }
}

function insertTalent(db: Db, bus: EventBus, userId: string, option: TalentDef) {
  addTalent(db, userId, talentRow(option))
  bus.emit('talent.chosen', {
    userId,
    talentId: option.id,
    skillId: option.skillId,
    milestone: option.milestone,
    tier: option.tier,
  })
  return { ok: true, talent: option }
}

function replaceExisting(
  db: Db,
  bus: EventBus,
  userId: string,
  option: TalentDef,
  fromTalentId: string,
): void {
  replaceTalent(db, userId, fromTalentId, talentRow(option))
  bus.emit('talent.changed', {
    userId,
    talentId: option.id,
    fromTalentId,
    skillId: option.skillId,
    milestone: option.milestone,
    tier: option.tier,
  })
}

/** The stored row a talent choice writes. */
function talentRow(option: TalentDef) {
  return {
    talentId: option.id,
    skillId: option.skillId,
    tier: option.tier,
    milestone: option.milestone,
  }
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
  const req = chooseRequest(db, userId, talentId)
  if ('error' in req) return { ok: false, error: req.error }
  const invalid =
    req.parsed.kind === 'mastery'
      ? masteryGuard(db, userId, req.parsed.milestone, req.level, req.option)
      : choiceGuard(req.level, req.parsed.milestone, req.mine)
  if (invalid) return { ok: false, error: invalid }
  return applyTalent(db, bus, userId, req.option, req.mine)
}

interface ChooseReq {
  parsed: NonNullable<ReturnType<typeof parseTalentId>>
  option: TalentDef
  level: number
  mine: TalentRow[]
}

/** Resolves the requested option and the current state, or the reason it is bad. */
function chooseRequest(db: Db, userId: string, talentId: string): ChooseReq | { error: string } {
  const parsed = parseTalentId(talentId)
  if (!parsed) return { error: 'not a talent' }
  const option = optionsFor(parsed.skillId, parsed.milestone, parsed.kind).find(
    (o) => o.id === talentId,
  )
  if (!option) return { error: 'invalid talent option' }
  return {
    parsed,
    option,
    level: skillLevelOf(db, userId, parsed.skillId),
    mine: listTalents(db, userId).filter((r) => r.skillId === parsed.skillId),
  }
}

/** A mastery capstone: Lv 50/100, plus the feeding profession's level. */
function masteryGuard(
  db: Db,
  userId: string,
  milestone: number,
  level: number,
  option: TalentDef,
): string | undefined {
  if (!MASTERY_MILESTONES.includes(milestone)) return 'not a mastery milestone'
  if (level < milestone) return 'milestone not reached'
  const unmet = option.requires.filter((r) => skillLevelOf(db, userId, r.skill) < r.level)
  if (!unmet.length) return undefined
  return `requires ${unmet.map((r) => `${r.skill} ${r.level}`).join(', ')}`
}

/** Choice tier: every 10 levels, taken in order with no skipping ahead. */
function choiceGuard(level: number, milestone: number, mine: TalentRow[]): string | undefined {
  const milestones = talentMilestones(level)
  if (!milestones.includes(milestone)) return 'milestone not reached'
  const choices = mine.filter((r) => r.tier === 'choice')
  if (choices.some((r) => r.milestone === milestone)) return undefined
  if (choices.length >= milestones.length) return 'no pending talent choice'
  return milestone === milestones[choices.length] ? undefined : 'not the current milestone'
}

/** The shape `talentView` returns for one owned talent (choice or mastery). */
function ownedTalents(db: Db, userId: string, rows: TalentRow[]) {
  return resolveTalents(rows).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    milestone: t.milestone,
    tier: t.tier,
    mods: t.mods,
    requires: requiresView(db, userId, t.requires),
    // the other options at the same tier + milestone (so it can be changed)
    options: optionsFor(t.skillId, t.milestone, t.tier).map((o) => optionView(db, userId, o)),
  }))
}

function optionView(db: Db, userId: string, o: TalentDef) {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    mods: o.mods,
    requires: requiresView(db, userId, o.requires),
  }
}

function requiresView(db: Db, userId: string, reqs: TalentDef['requires']) {
  return reqs.map((r) => ({ ...r, met: skillLevelOf(db, userId, r.skill) >= r.level }))
}

/** Per-skill talent state for the UI (choice milestone + mastery capstones). */
export function talentView(db: Db, userId: string) {
  const owned = listTalents(db, userId) as TalentRow[]
  return SKILLS.map((s) => skillTalentView(db, userId, s, owned))
}

function skillTalentView(db: Db, userId: string, s: SkillDef, owned: TalentRow[]) {
  const level = skillLevelOf(db, userId, s.id)
  const mine = owned.filter((r) => r.skillId === s.id)
  const choices = mine.filter((r) => r.tier === 'choice')
  const { pending, nextMilestone, nextChoice } = choiceState(level, choices)
  return {
    skillId: s.id,
    level,
    pendingChoice: pending,
    milestone: nextMilestone,
    options: nextMilestone ? talentOptions(s.id, nextMilestone) : [],
    nextMilestone: nextChoice,
    synergy: synergyView(s.id, mine),
    owned: ownedTalents(db, userId, choices),
    mastery: masteryView(db, userId, s.id, level, mine),
  }
}

function choiceState(level: number, choices: TalentRow[]) {
  const milestones = talentMilestones(level)
  const pending = milestones.length > choices.length
  const nextMilestone = pending ? milestones[choices.length]! : null
  // Every 10-level choice in the game; `null` once they are all taken.
  const nextChoice = pending
    ? nextMilestone
    : (talentMilestones(ACTION_MAX_LEVEL)[choices.length] ?? null)
  return { pending, nextMilestone, nextChoice }
}

/** The profession this one trades with, and where its synergy talent is taken. */
function synergyView(skillId: SkillId, mine: TalentRow[]) {
  const syn = SYNERGY[skillId]
  const taken = mine
    .filter((r) => r.tier === 'choice' && isSynergy(r, skillId))
    .map((r) => r.milestone)
    .sort((a, b) => a - b)
  return {
    target: syn.target,
    name: SKILL_BY_ID.get(syn.target)?.name ?? syn.target,
    label: syn.name,
    taken,
  }
}

function isSynergy(row: TalentRow, skillId: SkillId): boolean {
  return resolveTalents([row])[0]?.mods.some((m) => m.synergy === skillId) ?? false
}

function masteryView(db: Db, userId: string, skillId: SkillId, level: number, mine: TalentRow[]) {
  const masteries = mine.filter((r) => r.tier === 'mastery')
  const pending = MASTERY_MILESTONES.filter(
    (m) => level >= m && !masteries.some((t) => t.milestone === m),
  ).map((m) => ({
    milestone: m,
    options: masteryOptions(skillId, m).map((o) => optionView(db, userId, o)),
  }))
  return {
    milestones: MASTERY_MILESTONES,
    // the next not-yet-reached capstone, or null once both are done
    next: MASTERY_MILESTONES.find((m) => level < m) ?? null,
    pending,
    owned: ownedTalents(db, userId, masteries),
  }
}
