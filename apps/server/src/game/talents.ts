/**
 * Talents (docs/DESIGN.md §13.5).
 *
 *  * **Choice** tier: every 10 levels (10, 20, 30, …) → choose **one of three**.
 *  * **Mastery** tier: at the Lv 50 and Lv 100 capstones → choose **one of two**,
 *    each gated on a level in the profession that feeds this one.
 *  * A choice can be changed later at the same milestone (a free respec).
 *
 * Ids encode the skill + milestone + tier so they're unique and stackable, which
 * lets progression continue indefinitely.
 */

import type { Mod, ModKind, SkillId, UnlockReq } from './skills'
import { SKILL_BY_ID } from './skills'

export interface TalentDef {
  id: string
  skillId: SkillId
  milestone: number
  name: string
  description: string
  mods: Mod[]
  /** `choice` (every 10 levels) or `mastery` (the Lv 50/100 capstone). */
  tier: 'choice' | 'mastery'
  /** Cross-profession gate (mastery talents only; empty for choices). */
  requires: UnlockReq[]
}

/**
 * The cross-profession talent each profession can take at every milestone: it
 * feeds a bonus into *another* profession, **scaled by the owning profession's own
 * level**. Investing in Mining therefore makes Smithing level faster, and vice
 * versa — this is what makes the professions build off each other rather than only
 * trading materials.
 *
 * `target` is the profession that receives the bonus, `synergy` (implicitly the
 * owning profession) is the one whose level scales it.
 */
export interface SynergyDef {
  target: SkillId
  kind: ModKind
  /** per point of the owning profession's derived level */
  value: number
  name: string
  /** human blurb, built in `talentOptions` */
  blurb: string
}

export const SYNERGY: Record<SkillId, SynergyDef> = {
  // gathering → the artisan that consumes its goods
  mining: { target: 'smithing', kind: 'xp', value: 0.005, name: 'Ore Sense', blurb: 'Smithing' },
  woodcutting: {
    target: 'fletching',
    kind: 'xp',
    value: 0.005,
    name: 'Timber Sense',
    blurb: 'Fletching',
  },
  fishing: { target: 'cooking', kind: 'xp', value: 0.005, name: "Angler's Eye", blurb: 'Cooking' },
  farming: { target: 'herblore', kind: 'xp', value: 0.005, name: 'Green Thumb', blurb: 'Herblore' },
  // artisan → the gatherer that feeds it (mutual: the chains reinforce each other)
  smithing: { target: 'mining', kind: 'yield', value: 0.005, name: 'Deep Veins', blurb: 'Mining' },
  cooking: { target: 'fishing', kind: 'yield', value: 0.005, name: 'Chumming', blurb: 'Fishing' },
  herblore: { target: 'farming', kind: 'yield', value: 0.005, name: 'Compost', blurb: 'Farming' },
  fletching: {
    target: 'woodcutting',
    kind: 'yield',
    value: 0.005,
    name: 'Sawdust',
    blurb: 'Woodcutting',
  },
  runecrafting: { target: 'magic', kind: 'xp', value: 0.005, name: 'Resonance', blurb: 'Magic' },
  crafting: {
    target: 'enchanting',
    kind: 'xp',
    value: 0.005,
    name: 'Lapidary',
    blurb: 'Enchanting',
  },
  firemaking: { target: 'cooking', kind: 'xp', value: 0.005, name: 'Embers', blurb: 'Cooking' },
  construction: {
    target: 'crafting',
    kind: 'xp',
    value: 0.005,
    name: 'Carpentry',
    blurb: 'Crafting',
  },
  enchanting: {
    target: 'runecrafting',
    kind: 'yield',
    value: 0.005,
    name: 'Attunement',
    blurb: 'Runecrafting',
  },
  // support → each other
  thieving: {
    target: 'agility',
    kind: 'xp',
    value: 0.005,
    name: 'Escape Artist',
    blurb: 'Agility',
  },
  agility: { target: 'thieving', kind: 'xp', value: 0.005, name: 'Footwork', blurb: 'Thieving' },
  // combat → the artisan/mage that gears it, or the sibling art
  attack: { target: 'strength', kind: 'xp', value: 0.005, name: 'Bladework', blurb: 'Strength' },
  strength: { target: 'attack', kind: 'xp', value: 0.005, name: 'Momentum', blurb: 'Attack' },
  defence: {
    target: 'constitution',
    kind: 'xp',
    value: 0.005,
    name: 'Stalwart',
    blurb: 'Constitution',
  },
  constitution: {
    target: 'defence',
    kind: 'xp',
    value: 0.005,
    name: 'Toughness',
    blurb: 'Defence',
  },
  ranged: { target: 'fletching', kind: 'xp', value: 0.005, name: 'Bowyery', blurb: 'Fletching' },
  magic: {
    target: 'enchanting',
    kind: 'xp',
    value: 0.005,
    name: 'Arcane Study',
    blurb: 'Enchanting',
  },
  prayer: { target: 'slayer', kind: 'xp', value: 0.005, name: 'Devotion', blurb: 'Slayer' },
  slayer: {
    target: 'attack',
    kind: 'xp',
    value: 0.005,
    name: "Hunter's Instinct",
    blurb: 'Attack',
  },
}

/**
 * A synergy talent's effect written out in full, e.g.
 * `+0.5% Mining yield per Smithing level`. The talent ladder and the skill page's
 * "feeds / fed by" rows all use this so they can never drift apart.
 */
export function synergyDescription(skillId: SkillId): string {
  const syn = SYNERGY[skillId]
  const owner = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const per = Math.round(syn.value * 1000) / 10 // 0.005 → 0.5
  const unit = syn.kind === 'yield' ? 'yield' : 'XP'
  return `+${per}% ${syn.blurb} ${unit} per ${owner} level`
}

/** Choice milestones up to `level` (10, 20, 30, …). */
export function talentMilestones(level: number): number[] {
  const out: number[] = []
  for (let l = 10; l <= level; l += 10) out.push(l)
  return out
}

const isCombat = (skillId: SkillId) => SKILL_BY_ID.get(skillId)?.category === 'combat'

/**
 * The options offered at a 10-level milestone. Three choices:
 *   1. a flat boost to this profession's own output (Prospector / Keen strikes),
 *   2. **Studious** — +5% XP to every profession,
 *   3. a **synergy** talent that feeds another profession, scaled by this one's level.
 */
export function talentOptions(skillId: SkillId, milestone: number): TalentDef[] {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const combat = isCombat(skillId)
  const base = { skillId, milestone, tier: 'choice' as const, requires: [] as UnlockReq[] }
  const syn = SYNERGY[skillId]
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
    {
      ...base,
      id: `${skillId}:t:${milestone}:3`,
      name: syn.name,
      // the synergy: +X% to the target per level of *this* profession
      description: synergyDescription(skillId),
      mods: [{ kind: syn.kind, value: syn.value, skill: syn.target, synergy: skillId }],
    },
  ]
}

/** The levels at which a **mastery** talent (the capstone) opens up. */
export const MASTERY_MILESTONES = [50, 100]

/**
 * The permanent output a **Lv-100 Legendary** capstone grants, per effect kind.
 * The Lv-100 self option deliberately does **not** grant XP: a profession only
 * reaches 100 when every one of its actions is already at the cap, so its XP would
 * be dead weight. Instead it converts mastery into the profession's own *output*,
 * which never goes stale.
 */
const LEGENDARY_VALUE: Record<ModKind, number> = {
  yield: 0.25,
  double: 0.1,
  coins: 0.5,
  global_xp: 0.05,
  damage: 0.2,
  drop: 0.2,
  hp: 0.1,
  xp: 0.25, // unreachable: no profession's own passive is 'xp'
}
const LEGENDARY_LABEL: Record<ModKind, string> = {
  yield: 'yield',
  double: 'bonus product chance',
  coins: 'coins',
  global_xp: 'global XP',
  damage: 'combat power',
  drop: 'rare drops',
  hp: 'HP',
  xp: 'XP',
}
/** Kinds `computeBonuses` scopes to a profession (the rest are global). */
const SCOPED_KINDS: ModKind[] = ['yield', 'double', 'xp', 'coins']

/** The Legendary self-mod: the profession's own effect, at capstone strength. */
function legendaryMod(skillId: SkillId): Mod {
  const kind = SKILL_BY_ID.get(skillId)!.effect.kind
  return {
    kind,
    value: LEGENDARY_VALUE[kind],
    ...(SCOPED_KINDS.includes(kind) ? { skill: skillId } : {}),
  }
}

/**
 * The two capstone choices at a mastery milestone. Both are gated on the
 * profession that feeds this one (`SYNERGY[skill].target`), so a mastery is earned
 * by *cross-training*, not just by grinding:
 *
 *   1. **Grandmaster <Name>** (Lv 50) — +25% XP to this profession's own actions,
 *      which still matters because you are only halfway. Needs the partner at 20.
 *      **Legendary <Name>** (Lv 100) — instead a *permanent* output bonus (the
 *      profession's own passive at capstone strength), because at 100 the
 *      profession's XP can no longer buy anything. Needs the partner at 40.
 *   2. **Patron / Grand Patron of <Partner>** — +0.5% / +1% partner XP **per level
 *      of this profession** (needs the partner at 30 / 50), so the other line —
 *      which is not maxed — levels faster.
 */
export function masteryOptions(skillId: SkillId, milestone: number): TalentDef[] {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const syn = SYNERGY[skillId]
  const partner = syn.target
  const partnerName = SKILL_BY_ID.get(partner)?.name ?? partner
  const capstone = milestone >= 100
  const giftPct = capstone ? 1 : 0.5
  const needSelf = capstone ? 40 : 20
  const needGift = capstone ? 50 : 30
  const base = { skillId, milestone, tier: 'mastery' as const }

  const selfMod: Mod = capstone
    ? legendaryMod(skillId)
    : { kind: 'xp', value: 0.25, skill: skillId }
  const selfPer = Math.round(selfMod.value * 100)
  const selfLabel = capstone
    ? `+${selfPer}% ${LEGENDARY_LABEL[selfMod.kind]} forever`
    : `+${selfPer}% XP to every ${name} action`

  return [
    {
      ...base,
      id: `${skillId}:m:${milestone}:1`,
      name: `${capstone ? 'Legendary' : 'Grandmaster'} ${name}`,
      description: `${selfLabel} (needs ${partnerName} ${needSelf})`,
      mods: [selfMod],
      requires: [{ skill: partner, level: needSelf }],
    },
    {
      ...base,
      id: `${skillId}:m:${milestone}:2`,
      name: `${capstone ? 'Grand ' : ''}Patron of ${partnerName}`,
      description: `+${giftPct}% ${partnerName} XP per ${name} level (needs ${partnerName} ${needGift})`,
      mods: [{ kind: 'xp', value: giftPct / 100, skill: partner, synergy: skillId }],
      requires: [{ skill: partner, level: needGift }],
    },
  ]
}

export interface ParsedTalentId {
  skillId: SkillId
  milestone: number
  /** `t` = choice, `m` = mastery. */
  kind: 'choice' | 'mastery'
}

export function parseTalentId(id: string): ParsedTalentId | null {
  const parts = id.split(':')
  if (parts.length < 3) return null
  const [skillId, kind, milestoneStr] = parts
  const milestone = Number(milestoneStr)
  if (!skillId || !Number.isFinite(milestone)) return null
  if (kind !== 't' && kind !== 'm') return null
  if (!SKILL_BY_ID.has(skillId as SkillId)) return null
  return { skillId: skillId as SkillId, milestone, kind: kind === 'm' ? 'mastery' : 'choice' }
}

/** The options offered at a milestone, whichever tier it belongs to. */
export function optionsFor(skillId: SkillId, milestone: number, kind: 'choice' | 'mastery') {
  return kind === 'mastery' ? masteryOptions(skillId, milestone) : talentOptions(skillId, milestone)
}

/** All talents a player currently owns, resolved to definitions. */
export function resolveTalents(rows: { talentId: string }[]): TalentDef[] {
  const out: TalentDef[] = []
  for (const r of rows) {
    const parsed = parseTalentId(r.talentId)
    if (!parsed) continue
    const found = optionsFor(parsed.skillId, parsed.milestone, parsed.kind).find(
      (t) => t.id === r.talentId,
    )
    if (found) out.push(found)
  }
  return out
}
