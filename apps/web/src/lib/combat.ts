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
  /** fraction of damage dealt returned as HP (iron bands/enchants) */
  lifesteal: number
  gearScore: number
  setBonuses: ActiveSetBonusDTO[]
  level: number
}

export interface CombatResponse {
  monsters: MonsterDTO[]
  player: CombatPlayerDTO
  /** Cards with a review state — combat is review only. 0 means "practise first". */
  reviewCount: number
  encounter: EncounterDTO | null
  /** The current drill when a fight is in progress (null otherwise). */
  instance: Instance | null
}

export interface Buff {
  kind: 'power' | 'maxHp'
  value: number
}

export interface HitResult {
  correct: boolean
  /** The combat profession the equipped weapon trains for this fight. */
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
  /** XP trained in Defence / Constitution from the blow you take every exchange. */
  defenceXp: number
  constitutionXp: number
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

/** Flee the active fight: drop the encounter, no rewards, no penalty. */
export const abandonFight = () => api<{ encounter: null }>('/api/combat/leave', { method: 'POST' })

/** Seconds a learner gets to answer each drill in a fight (time attack). */
export const COMBAT_TIME_LIMIT_MS = 20_000

export const combatHit = (body: {
  exerciseId: string
  cardId: string
  answer: unknown
  /** The timer ran out; the server grades it as a miss without grading the answer. */
  timedOut?: boolean
}) =>
  api<{
    result: Grade
    hit: HitResult
    encounter: EncounterDTO | null
    instance: Instance | null
    stats: Stats
  }>('/api/combat/hit', { method: 'POST', body: JSON.stringify(body) })
