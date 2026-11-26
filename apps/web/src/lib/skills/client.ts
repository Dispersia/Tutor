import { api } from '../api'
import type {
  GearResponse,
  GearSetApplyResponse,
  ItemDetailDTO,
  SkillsResponse,
  SkillPageResponse,
  StopRigResponse,
  GearSetDTO,
} from './types'

export const getSkills = () => api<SkillsResponse>('/api/skills')

export const getGear = () => api<GearResponse>('/api/skills/gear')

export const getItem = (id: string) =>
  api<ItemDetailDTO>(`/api/skills/items/${encodeURIComponent(id)}`)

export const getSkill = (id: string) =>
  api<SkillPageResponse>(`/api/skills/${encodeURIComponent(id)}`)

export const chooseTalent = (talentId: string) =>
  api('/api/skills/talents', { method: 'POST', body: JSON.stringify({ talentId }) })

export const chooseAction = (actionId: string, choiceId: string) =>
  api('/api/skills/choice', { method: 'POST', body: JSON.stringify({ actionId, choiceId }) })

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

export const applyEnchant = (instanceId: string, enchantId: string) =>
  api<GearResponse>('/api/skills/gear/enchant', {
    method: 'POST',
    body: JSON.stringify({ instanceId, enchantId }),
  })

export const distillGear = (itemId: string, count = 1) =>
  api<GearResponse & { xp: number; essence: string }>('/api/skills/gear/distill', {
    method: 'POST',
    body: JSON.stringify({ itemId, count }),
  })

export const setDistillMode = (mode: string) =>
  api<GearResponse>('/api/skills/gear/distill/mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })

export const toggleDistill = (itemId: string) =>
  api<GearResponse>('/api/skills/gear/distill/toggle', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
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
