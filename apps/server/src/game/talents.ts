import type { Mod, ModKind, SkillId, UnlockReq } from './skills'
import { SKILL_BY_ID } from './skills'

export interface TalentDef {
  id: string
  skillId: SkillId
  milestone: number
  name: string
  description: string
  mods: Mod[]
  tier: 'choice' | 'mastery'
  requires: UnlockReq[]
}

export interface SynergyDef {
  target: SkillId
  kind: ModKind
  value: number
  name: string
  blurb: string
}

export const SYNERGY: Record<SkillId, SynergyDef> = {
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
  leatherworking: {
    target: 'ranged',
    kind: 'xp',
    value: 0.005,
    name: 'Hidecraft',
    blurb: 'Ranged',
  },
  tailoring: {
    target: 'magic',
    kind: 'xp',
    value: 0.005,
    name: 'Weave',
    blurb: 'Magic',
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
  thieving: {
    target: 'agility',
    kind: 'xp',
    value: 0.005,
    name: 'Escape Artist',
    blurb: 'Agility',
  },
  agility: { target: 'thieving', kind: 'xp', value: 0.005, name: 'Footwork', blurb: 'Thieving' },
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

export function synergyDescription(skillId: SkillId): string {
  const syn = SYNERGY[skillId]
  const owner = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const per = Math.round(syn.value * 1000) / 10
  const unit = syn.kind === 'yield' ? 'yield' : 'XP'
  return `+${per}% ${syn.blurb} ${unit} per ${owner} level`
}

export function talentMilestones(level: number): number[] {
  const out: number[] = []
  for (let l = 10; l <= level; l += 10) out.push(l)
  return out
}

const isCombat = (skillId: SkillId) => SKILL_BY_ID.get(skillId)?.category === 'combat'

export function talentOptions(skillId: SkillId, milestone: number): TalentDef[] {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const base: ChoiceBase = {
    skillId,
    milestone,
    tier: 'choice',
    requires: [],
  }
  const combat = isCombat(skillId)
  return [outputOption(base, name, combat), studiousOption(base), synergyOption(base)]
}

interface ChoiceBase {
  skillId: SkillId
  milestone: number
  tier: 'choice'
  requires: UnlockReq[]
}

function outputOption(base: ChoiceBase, name: string, combat: boolean): TalentDef {
  return {
    ...base,
    id: `${base.skillId}:t:${base.milestone}:1`,
    name: combat ? 'Keen strikes' : 'Prospector',
    description: combat ? '+15% combat power' : `+15% ${name} yield`,
    mods: [
      combat
        ? { kind: 'damage', value: 0.15 }
        : { kind: 'yield', value: 0.15, skill: base.skillId },
    ],
  }
}

function studiousOption(base: ChoiceBase): TalentDef {
  return {
    ...base,
    id: `${base.skillId}:t:${base.milestone}:2`,
    name: 'Studious',
    description: '+5% XP to every profession',
    mods: [{ kind: 'global_xp', value: 0.05 }],
  }
}

function synergyOption(base: ChoiceBase): TalentDef {
  const syn = SYNERGY[base.skillId]
  return {
    ...base,
    id: `${base.skillId}:t:${base.milestone}:3`,
    name: syn.name,
    description: synergyDescription(base.skillId),
    mods: [{ kind: syn.kind, value: syn.value, skill: syn.target, synergy: base.skillId }],
  }
}

export const MASTERY_MILESTONES = [50, 100]

const LEGENDARY_VALUE: Record<ModKind, number> = {
  yield: 0.25,
  double: 0.1,
  coins: 0.5,
  global_xp: 0.05,
  damage: 0.2,
  drop: 0.2,
  hp: 0.1,
  xp: 0.25,
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
const SCOPED_KINDS: ModKind[] = ['yield', 'double', 'xp', 'coins']

function legendaryMod(skillId: SkillId): Mod {
  const kind = SKILL_BY_ID.get(skillId)!.effect.kind
  return {
    kind,
    value: LEGENDARY_VALUE[kind],
    ...(SCOPED_KINDS.includes(kind) ? { skill: skillId } : {}),
  }
}

export function masteryOptions(skillId: SkillId, milestone: number): TalentDef[] {
  const ctx = masteryCtx(skillId, milestone)
  return [selfOption(ctx), patronOption(ctx)]
}

interface MasteryCtx {
  skillId: SkillId
  milestone: number
  name: string
  partner: SkillId
  partnerName: string
  capstone: boolean
  giftPct: number
  needSelf: number
  needGift: number
  base: { skillId: SkillId; milestone: number; tier: 'mastery' }
  selfMod: Mod
  selfLabel: string
}

function masteryCtx(skillId: SkillId, milestone: number): MasteryCtx {
  const name = SKILL_BY_ID.get(skillId)?.name ?? skillId
  const partner = SYNERGY[skillId].target
  const capstone = milestone >= 100
  const self = selfParts(skillId, name, capstone)
  return {
    skillId,
    milestone,
    name,
    partner,
    partnerName: SKILL_BY_ID.get(partner)?.name ?? partner,
    capstone,
    giftPct: capstone ? 1 : 0.5,
    needSelf: capstone ? 40 : 20,
    needGift: capstone ? 50 : 30,
    base: { skillId, milestone, tier: 'mastery' },
    ...self,
  }
}

function selfParts(skillId: SkillId, name: string, capstone: boolean) {
  const selfMod: Mod = capstone
    ? legendaryMod(skillId)
    : { kind: 'xp', value: 0.25, skill: skillId }
  const per = Math.round(selfMod.value * 100)
  const selfLabel = capstone
    ? `+${per}% ${LEGENDARY_LABEL[selfMod.kind]} forever`
    : `+${per}% XP to every ${name} action`
  return { selfMod, selfLabel }
}

function selfOption(c: MasteryCtx): TalentDef {
  return {
    ...c.base,
    id: `${c.skillId}:m:${c.milestone}:1`,
    name: `${c.capstone ? 'Legendary' : 'Grandmaster'} ${c.name}`,
    description: `${c.selfLabel} (needs ${c.partnerName} ${c.needSelf})`,
    mods: [c.selfMod],
    requires: [{ skill: c.partner, level: c.needSelf }],
  }
}

function patronOption(c: MasteryCtx): TalentDef {
  return {
    ...c.base,
    id: `${c.skillId}:m:${c.milestone}:2`,
    name: `${c.capstone ? 'Grand ' : ''}Patron of ${c.partnerName}`,
    description: `+${c.giftPct}% ${c.partnerName} XP per ${c.name} level (needs ${c.partnerName} ${c.needGift})`,
    mods: [{ kind: 'xp', value: c.giftPct / 100, skill: c.partner, synergy: c.skillId }],
    requires: [{ skill: c.partner, level: c.needGift }],
  }
}

export interface ParsedTalentId {
  skillId: SkillId
  milestone: number
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

export function optionsFor(skillId: SkillId, milestone: number, kind: 'choice' | 'mastery') {
  return kind === 'mastery' ? masteryOptions(skillId, milestone) : talentOptions(skillId, milestone)
}

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
