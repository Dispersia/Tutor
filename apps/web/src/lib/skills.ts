import { api } from './api'
import type { ModKind } from './types'

export interface Cost {
  item: string
  count: number
}

/** One action's idle rig as the UI needs it (docs/DESIGN.md §13.5.1). */
export interface IdleRigDTO {
  actionId: string
  /** lifetime drills that powered this rig */
  completions: number
  /** run still alive */
  active: boolean
  /** ms epoch when the run ends (0 if never) */
  runEndsAt: number
  /** whole seconds left (server-computed) */
  secondsLeft: number
  /** whole seconds a fresh completion's run lasts at this level */
  runSec: number
  /** seconds between items right now (tier-scaled) */
  intervalSec: number
  /** fraction already baked into a run (yield + double) */
  yieldBonus: number
  produces: Cost[]
  consumes: Cost[]
}

export interface ActionDTO {
  id: string
  skillId: string
  name: string
  description: string
  tier: number
  xp: number
  /** this action's own level (the profession level is the sum of these) */
  level: number
  /** this action's own XP + progress toward its next level */
  actionXp: number
  intoLevel: number
  forNext: number
  progress: number
  /** the action's passive at its current level (a fraction; 0.04 = +4%) */
  effect: { kind: ModKind; value: number }
  consumes?: Cost[]
  produces?: Cost[]
  /** the idle rig this action powers (null = never completed) */
  idle: IdleRigDTO | null
  equip?: { slot: string; tag: string }
  unlocked: boolean
  affordable: boolean
  missing: Cost[]
  missingUnlocks: { skill: string; level: number }[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
}

export interface TalentRequirement {
  /** the profession that must be trained */
  skill: string
  level: number
  /** whether the player currently meets it (server-computed) */
  met?: boolean
}

export interface TalentOption {
  id: string
  name: string
  description: string
  mods: { kind: ModKind; value: number; skill?: string; synergy?: string }[]
  /** cross-profession gate (mastery options only) */
  requires?: TalentRequirement[]
}

export interface OwnedTalent {
  id: string
  name: string
  description: string
  milestone: number
  tier: 'choice' | 'mastery'
  mods: { kind: ModKind; value: number; skill?: string; synergy?: string }[]
  requires?: TalentRequirement[]
  /** the other option(s) at this tier + milestone, so it can be changed */
  options: TalentOption[]
}

/** A mastery capstone whose level is reached but that is not taken yet. */
export interface MasteryPending {
  milestone: number
  options: TalentOption[]
}

export interface SkillTalentDTO {
  pendingChoice: boolean
  milestone: number | null
  options: TalentOption[]
  /** the next 10-level milestone, or null once every one is taken */
  nextMilestone: number | null
  /** talents already chosen for this profession (choice tier) */
  owned: OwnedTalent[]
  /**
   * The profession this one trades with: this profession feeds `target`, and
   * `target` gates this profession's mastery capstone. The web, made explicit.
   * `label` is the synergy talent's name; `taken` is where it is already owned.
   */
  synergy: {
    target: string
    name: string
    label: string
    /** milestones where the synergy talent is taken (empty → no link shown) */
    taken: number[]
  }
  /** the Lv 50 / Lv 100 capstone tier, gated on the profession that feeds this one */
  mastery: {
    milestones: number[]
    /** the next not-yet-reached capstone (50, 100, then null) */
    next: number | null
    pending: MasteryPending[]
    owned: OwnedTalent[]
  }
}

export interface SkillDTO {
  id: string
  name: string
  category: 'gathering' | 'artisan' | 'support' | 'combat'
  icon: string
  description: string
  /** the sum of this profession's action levels — the profession has no XP own */
  level: number
  xp: number
  /** the average of its actions' progress toward their next level */
  progress: number
  /** the passive every action of this profession gains per level */
  effect: { kind: ModKind; value: number }
  effectLabel: string
  talent: SkillTalentDTO
  actions: ActionDTO[]
}

export interface ItemDTO {
  id: string
  name: string
  icon: string
  description: string
  tier: string
  slot?: string
  tags?: string[]
  heal?: number
  buff?: { kind: string; value: number }
}

export interface SkillsResponse {
  skills: SkillDTO[]
  items: ItemDTO[]
  inventory: { itemId: string; count: number }[]
  equipment: { slot: string; itemId: string }[]
  bonuses: { globalXp: number; damage: number; drop: number; hp: number }
}

export const getSkills = () => api<SkillsResponse>('/api/skills')

/** One cross-training edge: a talent in `skillId` that feeds this profession. */
export interface FedBy {
  skillId: string
  name: string
  /** the talent's name, e.g. "Deep Veins" */
  label: string
  /** milestones where the feeder owns that talent (empty → nothing is fed) */
  taken: number[]
}

export interface SkillPageResponse {
  skill: SkillDTO
  /** professions whose synergy talent feeds this one (the reverse edge of the web) */
  fedBy: FedBy[]
  items: ItemDTO[]
  /** where each material is produced: itemId → the action that makes it */
  sources: Record<string, { skillId: string; actionId: string }>
  inventory: { itemId: string; count: number }[]
  equipment: { slot: string; itemId: string }[]
  bonuses: { globalXp: number; damage: number; drop: number; hp: number }
}

export const getSkill = (id: string) =>
  api<SkillPageResponse>(`/api/skills/${encodeURIComponent(id)}`)

export const chooseTalent = (talentId: string) =>
  api('/api/skills/talents', { method: 'POST', body: JSON.stringify({ talentId }) })

export const equipItem = (itemId: string) =>
  api('/api/skills/equip', { method: 'POST', body: JSON.stringify({ itemId }) })

export const unequipSlot = (slot: string) =>
  api('/api/skills/equip', { method: 'POST', body: JSON.stringify({ slot, unequip: true }) })

export interface SkillOutcome {
  actionId: string
  skillId: string
  xp: number
  /** the action's own level (null when the drill did not count) */
  level: number | null
  /** the profession's derived level (null when the drill did not count) */
  skillLevel: number | null
  leveledUp: boolean
  gained: Cost[]
  consumed: Cost[]
  /** the rig this drill powered (null when the drill did not count) */
  idle: IdleRigDTO | null
  /** the profession milestone whose talent choice just opened (or null) */
  talentUnlocked: number | null
}
