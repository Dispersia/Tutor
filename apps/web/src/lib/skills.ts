import { api } from './api'
import type { ModKind } from './types'

export interface Cost {
  item: string
  count: number
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
  equip?: { slot: string; tag: string }
  unlocked: boolean
  affordable: boolean
  missing: Cost[]
  missingUnlocks: { skill: string; level: number }[]
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
}

export interface TalentOption {
  id: string
  name: string
  description: string
  mods: { kind: ModKind; value: number }[]
}

export interface OwnedTalent {
  id: string
  name: string
  description: string
  milestone: number
  mods: { kind: ModKind; value: number; skill?: string }[]
  /** the other option(s) at this milestone, so it can be changed */
  options: TalentOption[]
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
  talent: {
    pendingChoice: boolean
    milestone: number | null
    options: TalentOption[]
    /** the next 10-level milestone (whether or not it has been reached) */
    nextMilestone: number
    /** talents already chosen for this profession */
    owned: OwnedTalent[]
  }
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

export interface SkillPageResponse {
  skill: SkillDTO
  items: ItemDTO[]
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
  /** the profession milestone whose talent choice just opened (or null) */
  talentUnlocked: number | null
}
