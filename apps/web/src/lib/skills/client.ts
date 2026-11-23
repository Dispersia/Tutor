/**
 * The skills/gear API client (docs/ARCHITECTURE.md). Every
 * `fetch` wrapper over `/api/skills*`; the DTOs live in `types.ts`.
 */

import { api } from '../api'
import type {
  GearResponse,
  GearSetApplyResponse,
  SkillsResponse,
  SkillPageResponse,
  StopRigResponse,
  GearSetDTO,
} from './types'

export const getSkills = () => api<SkillsResponse>('/api/skills')

/** The gear screen's own payload (worn, rolled and saved sets). */
export const getGear = () => api<GearResponse>('/api/skills/gear')

export const getSkill = (id: string) =>
  api<SkillPageResponse>(`/api/skills/${encodeURIComponent(id)}`)

export const chooseTalent = (talentId: string) =>
  api('/api/skills/talents', { method: 'POST', body: JSON.stringify({ talentId }) })

/** Pick which recipe a choose-input action runs (prospect any ore, cut any gem). */
export const chooseAction = (actionId: string, choiceId: string) =>
  api('/api/skills/choice', { method: 'POST', body: JSON.stringify({ actionId, choiceId }) })

/** Stop a running rig on purpose (§13.5.1): frees its slot for another action. */
export const stopRig = (actionId: string) =>
  api<StopRigResponse>('/api/skills/rigs/stop', {
    method: 'POST',
    body: JSON.stringify({ actionId }),
  })

export const equipItem = (itemId: string) =>
  api<GearResponse>('/api/skills/equip', { method: 'POST', body: JSON.stringify({ itemId }) })

export const equipInstance = (instanceId: string, slot?: string) =>
  api<GearResponse>('/api/skills/equip', {
    method: 'POST',
    body: JSON.stringify({ instanceId, slot }),
  })

export const unequipSlot = (slot: string) =>
  api<GearResponse>('/api/skills/equip', {
    method: 'POST',
    body: JSON.stringify({ slot, unequip: true }),
  })

export const discardGear = (instanceId: string) =>
  api<GearResponse>('/api/skills/gear/discard', {
    method: 'POST',
    body: JSON.stringify({ instanceId }),
  })

export const salvageGear = (instanceId: string) =>
  api<GearResponse & { materials: { item: string; count: number }[] }>('/api/skills/gear/salvage', {
    method: 'POST',
    body: JSON.stringify({ instanceId }),
  })

/** Apply a catalog enchant to a crafted piece (§13.5.3.2). */
export const applyEnchant = (instanceId: string, enchantId: string) =>
  api<GearResponse>('/api/skills/gear/enchant', {
    method: 'POST',
    body: JSON.stringify({ instanceId, enchantId }),
  })

/** Distill an item: burn it for Enchanting XP (by value) and its essence (§13.5.3.2). */
export const distillGear = (itemId: string, count = 1) =>
  api<GearResponse & { xp: number; essence: string }>('/api/skills/gear/distill', {
    method: 'POST',
    body: JSON.stringify({ itemId, count }),
  })

export const saveGearSet = (name: string, combatStyle?: string) =>
  api<GearResponse & { set: GearSetDTO }>('/api/skills/gear/sets', {
    method: 'POST',
    body: JSON.stringify({ name, combatStyle }),
  })

export const applyGearSet = (setId: string) =>
  api<GearSetApplyResponse>('/api/skills/gear/sets/apply', {
    method: 'POST',
    body: JSON.stringify({ setId }),
  })

export const deleteGearSet = (setId: string) =>
  api<GearResponse>('/api/skills/gear/sets/delete', {
    method: 'POST',
    body: JSON.stringify({ setId }),
  })
