import { api } from './api'
import type { Grade, Instance, Stats } from './exercises'
import type { GearStats, ActiveSetBonusDTO } from './skills'

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
  monsterDamage: number
  monsterLevel: number
  xpReward: number
  playerHp: number
  playerMaxHp: number
  potionId?: string | null
  foodEaten?: number
  totalDamage: number
}

export interface CombatPlayerDTO {
  skill: string
  combatStyle: string
  maxHp: number
  hp: number
  armour: number
  weaponPower: number
  power: number
  stats: GearStats
  crit: number
  haste: number
  mastery: number
  lifesteal: number
  gearScore: number
  setBonuses: ActiveSetBonusDTO[]
  level: number
}

export interface CombatResponse {
  monsters: MonsterDTO[]
  player: CombatPlayerDTO
  reviewCount: number
  encounter: EncounterDTO | null
  instance: Instance | null
}

export interface Buff {
  kind: 'power' | 'maxHp'
  value: number
}

export interface HitResult {
  correct: boolean
  skill: string
  damage: number
  crit: boolean
  haste: boolean
  monsterHp: number
  monsterMaxHp: number
  monsterDamage: number
  monsterLevel: number
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

export const abandonFight = () => api<{ encounter: null }>('/api/combat/leave', { method: 'POST' })

export const COMBAT_TIME_LIMIT_MS = 20_000

export const combatHit = (body: {
  exerciseId: string
  cardId: string
  answer: unknown
  timedOut?: boolean
}) =>
  api<{
    result: Grade
    hit: HitResult
    encounter: EncounterDTO | null
    instance: Instance | null
    stats: Stats
  }>('/api/combat/hit', { method: 'POST', body: JSON.stringify(body) })
