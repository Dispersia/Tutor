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

export interface SkillDTO {
  id: string
  name: string
  category: 'gathering' | 'artisan' | 'support' | 'combat'
  icon: string
  description: string
  level: number
  xp: number
  intoLevel: number
  forNext: number
  progress: number
  effect: { kind: ModKind; value: number }
  effectLabel: string
  talent: {
    pendingChoice: boolean
    milestone: number | null
    options: TalentOption[]
    majors: number
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
}

export interface SkillsResponse {
  skills: SkillDTO[]
  items: ItemDTO[]
  inventory: { itemId: string; count: number }[]
  equipment: { slot: string; itemId: string }[]
  bonuses: { globalXp: number; damage: number; drop: number; hp: number }
}

export const getSkills = () => api<SkillsResponse>('/api/skills')

export const chooseTalent = (talentId: string) =>
  api('/api/skills/talents', { method: 'POST', body: JSON.stringify({ talentId }) })

export const equipItem = (itemId: string) =>
  api('/api/skills/equip', { method: 'POST', body: JSON.stringify({ itemId }) })

export const unequipSlot = (slot: string) =>
  api('/api/skills/equip', { method: 'POST', body: JSON.stringify({ slot, unequip: true }) })

export interface SkillOutcome {
  skillId: string
  xp: number
  level?: number
  leveledUp: boolean
  gained: Cost[]
  consumed: Cost[]
  grantedTalents: { id: string; name: string; description: string }[]
}
