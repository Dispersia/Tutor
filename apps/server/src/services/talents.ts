/** Choosing a talent at a milestone, and the talent board (docs/DESIGN.md §13.5). */

import { addTalent, listTalents, replaceTalent } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { ACTION_MAX_LEVEL, SKILL_BY_ID, SKILLS } from '../game/skills'
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
function ownedTalents(db: Db, userId: string, rows: TalentRow[]) {
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
      owned: ownedTalents(db, userId, choices),
      mastery: {
        milestones: MASTERY_MILESTONES,
        /** the next not-yet-reached capstone, or null once both are done */
        next: MASTERY_MILESTONES.find((m) => level < m) ?? null,
        pending: masteryPending,
        owned: ownedTalents(db, userId, masteries),
      },
    }
  })
}
