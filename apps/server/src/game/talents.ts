/**
 * Talents (docs/DESIGN.md §13.5).
 *
 *  * Every 5 levels (but not 10) → pick **one of three** minor talents.
 *  * Every 10 levels → a **single major** talent, granted automatically.
 *
 * Ids encode the skill + tier + milestone so they're unique and stackable, which
 * lets progression continue indefinitely.
 */

import type { Mod, SkillId } from './skills'
import { SKILL_BY_ID } from './skills'

export interface TalentDef {
  id: string
  skillId: SkillId
  tier: 'minor' | 'major'
  milestone: number
  name: string
  description: string
  mods: Mod[]
}

/** Minor-choice milestones up to `level` (5, 15, 25, …). */
export function minorMilestones(level: number): number[] {
  const out: number[] = []
  for (let l = 5; l <= level; l += 10) out.push(l)
  return out
}

/** Major milestones up to `level` (10, 20, 30, …). */
export function majorMilestones(level: number): number[] {
  const out: number[] = []
  for (let l = 10; l <= level; l += 10) out.push(l)
  return out
}

const isCombat = (skillId: SkillId) => SKILL_BY_ID.get(skillId)?.category === 'combat'

/** The three options offered at a minor milestone. */
export function minorOptions(skillId: SkillId, milestone: number): TalentDef[] {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const combat = isCombat(skillId)
  const base = { skillId, tier: 'minor' as const, milestone }
  return [
    {
      ...base,
      id: `${skillId}:m:${milestone}:1`,
      name: combat ? 'Keen strikes' : 'Prospector',
      description: combat ? '+10% combat power' : `+10% ${name} yield`,
      mods: [
        combat ? { kind: 'damage', value: 0.1 } : { kind: 'yield', value: 0.1, skill: skillId },
      ],
    },
    {
      ...base,
      id: `${skillId}:m:${milestone}:2`,
      name: 'Studious',
      description: '+5% XP to every profession',
      mods: [{ kind: 'global_xp', value: 0.05 }],
    },
    {
      ...base,
      id: `${skillId}:m:${milestone}:3`,
      name: combat ? 'Lucky strike' : 'Doubler',
      description: combat ? '+5% rare drop chance' : `+5% chance of a bonus ${name} product`,
      mods: [
        combat ? { kind: 'drop', value: 0.05 } : { kind: 'double', value: 0.05, skill: skillId },
      ],
    },
  ]
}

/** The single major talent granted at a major milestone. */
export function majorFor(skillId: SkillId, milestone: number): TalentDef {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const combat = isCombat(skillId)
  const tier = Math.max(1, Math.round(milestone / 10))
  return {
    id: `${skillId}:M:${milestone}`,
    skillId,
    tier: 'major',
    milestone,
    name: `${name} mastery ${tier}`,
    description: combat ? '+15% combat power and +5% XP' : `+15% ${name} yield and +5% XP`,
    mods: [
      combat ? { kind: 'damage', value: 0.15 } : { kind: 'yield', value: 0.15, skill: skillId },
      { kind: 'global_xp', value: 0.05 },
    ],
  }
}

export function parseTalentId(
  id: string,
): { skillId: SkillId; tier: 'minor' | 'major'; milestone: number } | null {
  const parts = id.split(':')
  if (parts.length < 3) return null
  const [skillId, kind, milestoneStr] = parts
  const milestone = Number(milestoneStr)
  if (!skillId || !Number.isFinite(milestone)) return null
  if (kind !== 'm' && kind !== 'M') return null
  return { skillId: skillId as SkillId, tier: kind === 'm' ? 'minor' : 'major', milestone }
}

/** All talents a player currently owns, resolved to definitions. */
export function resolveTalents(rows: { talentId: string }[]): TalentDef[] {
  const out: TalentDef[] = []
  for (const r of rows) {
    const parsed = parseTalentId(r.talentId)
    if (!parsed) continue
    out.push(
      parsed.tier === 'major'
        ? majorFor(parsed.skillId, parsed.milestone)
        : (minorOptions(parsed.skillId, parsed.milestone).find((t) => t.id === r.talentId) ??
            minorOptions(parsed.skillId, parsed.milestone)[0]!),
    )
  }
  return out
}
