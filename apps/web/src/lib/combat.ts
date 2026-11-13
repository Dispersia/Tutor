import { api } from './api'
import type { Grade, Instance, Stats } from './exercises'

export interface DropDef {
  item: string
  chance: number
  min: number
  max: number
}

export interface MonsterDTO {
  id: string
  name: string
  icon: string
  description: string
  level: number
  hp: number
  damage: number
  combatSkill: string
  xp: number
  deckLevel: string
  drops: DropDef[]
  unlocked: boolean
  missing: { skill: string; level: number }[]
  equipMissing: { slot: string; tag: string } | null
}

export interface EncounterDTO {
  monsterId: string
  monsterName: string
  monsterIcon: string
  monsterHp: number
  monsterMaxHp: number
  playerHp: number
  playerMaxHp: number
  potionId?: string | null
  foodEaten?: number
  totalDamage: number
}

export interface CombatResponse {
  monsters: MonsterDTO[]
  player: { maxHp: number; armour: number; weaponPower: number }
  encounter: EncounterDTO | null
}

export interface Buff {
  kind: 'power' | 'maxHp'
  value: number
}

export interface HitResult {
  correct: boolean
  damage: number
  monsterHp: number
  playerDamage: number
  playerHp: number
  playerMaxHp: number
  outcome: 'ongoing' | 'won' | 'lost'
  drops: { item: string; count: number }[]
  xp: number
  ate: { item: string; heal: number; playerHp: number } | null
  talentUnlocked: number | null
}

export const getCombat = () => api<CombatResponse>('/api/combat')

export const startFight = (monsterId: string) =>
  api<{
    monster: MonsterDTO
    encounter: EncounterDTO
    instance: Instance | null
    drank: { item: string; buff: Buff } | null
  }>('/api/combat/start', { method: 'POST', body: JSON.stringify({ monsterId }) })

export const combatHit = (body: { exerciseId: string; cardId: string; answer: unknown }) =>
  api<{
    result: Grade
    hit: HitResult
    encounter: EncounterDTO | null
    instance: Instance | null
    stats: Stats
  }>('/api/combat/hit', { method: 'POST', body: JSON.stringify(body) })
