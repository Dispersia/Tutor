/**
 * Talents (docs/DESIGN.md §13.5).
 *
 *  * Every 10 levels (10, 20, 30, …) → choose **one of two** talents.
 *  * A choice can be changed later at the same milestone (a free respec).
 *
 * Ids encode the skill + milestone so they're unique and stackable, which lets
 * progression continue indefinitely.
 */

import type { Mod, SkillId } from './skills'
import { SKILL_BY_ID } from './skills'

export interface TalentDef {
  id: string
  skillId: SkillId
  milestone: number
  name: string
  description: string
  mods: Mod[]
}

/** Choice milestones up to `level` (10, 20, 30, …). */
export function talentMilestones(level: number): number[] {
  const out: number[] = []
  for (let l = 10; l <= level; l += 10) out.push(l)
  return out
}

const isCombat = (skillId: SkillId) => SKILL_BY_ID.get(skillId)?.category === 'combat'

/** The two options offered at a 10-level milestone. */
export function talentOptions(skillId: SkillId, milestone: number): TalentDef[] {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const combat = isCombat(skillId)
  const base = { skillId, milestone }
  return [
    {
      ...base,
      id: `${skillId}:t:${milestone}:1`,
      name: combat ? 'Keen strikes' : 'Prospector',
      description: combat ? '+15% combat power' : `+15% ${name} yield`,
      mods: [
        combat ? { kind: 'damage', value: 0.15 } : { kind: 'yield', value: 0.15, skill: skillId },
      ],
    },
    {
      ...base,
      id: `${skillId}:t:${milestone}:2`,
      name: 'Studious',
      description: '+5% XP to every profession',
      mods: [{ kind: 'global_xp', value: 0.05 }],
    },
  ]
}

export function parseTalentId(id: string): { skillId: SkillId; milestone: number } | null {
  const parts = id.split(':')
  if (parts.length < 3) return null
  const [skillId, kind, milestoneStr] = parts
  const milestone = Number(milestoneStr)
  if (!skillId || !Number.isFinite(milestone)) return null
  if (kind !== 't') return null
  return { skillId: skillId as SkillId, milestone }
}

/** All talents a player currently owns, resolved to definitions. */
export function resolveTalents(rows: { talentId: string }[]): TalentDef[] {
  const out: TalentDef[] = []
  for (const r of rows) {
    const parsed = parseTalentId(r.talentId)
    if (!parsed) continue
    const found = talentOptions(parsed.skillId, parsed.milestone).find((t) => t.id === r.talentId)
    if (found) out.push(found)
  }
  return out
}
