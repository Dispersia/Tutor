import type { RigYield } from '@tutor/core'
import type { ModKind } from '../types'

interface Cost {
  item: string
  count: number
}

type BandId = 'bronze' | 'iron' | 'steel' | 'mythril' | 'adamant'

interface BandGate {
  id: BandId
  name: string
  level: number
  current: number
}

export interface BandDTO {
  id: BandId
  name: string
  icon: string
  tier: number
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
  gearUnlockLevel: number
  buffLabel: string
  buffStat: 'crit' | 'haste' | 'mastery' | 'stamina' | 'lifesteal'
  buffValue: number
  enchantLabel: string
  enchantLevel: number
  gearTotal: number
  gearUnlocked: number
  nextUnlock: { level: number; name: string } | null
}

export interface BandBuffs {
  crit: number
  haste: number
  mastery: number
  stamina: number
  lifesteal: number
}

export interface EnchantDTO {
  id: string
  name: string
  slot: string
  stat: string
  value: number
  level: number
  tier: number
  reagents: Cost[]
}

export const EFFECT_SHORT: Record<ModKind, string> = {
  yield: 'yield',
  double: 'bonus item',
  xp: 'XP',
  coins: 'coins',
  global_xp: 'XP',
  damage: 'power',
  drop: 'drops',
  hp: 'HP',
}

export interface IdleRigDTO {
  actionId: string
  completions: number
  active: boolean
  runEndsAt: number
  runStartedAt: number
  secondsLeft: number
  runSec: number
  maxRunSec: number
  runFullAtCompletions: number
  runProgress: number
  maxed: boolean
  intervalSec: number
  crafts: number
  xpPerCraft: number
  produces: RigYield[]
  consumes: Cost[]
}

export interface ActionDTO {
  id: string
  skillId: string
  name: string
  description: string
  tier: number
  xp: number
  level: number
  actionXp: number
  intoLevel: number
  forNext: number
  progress: number
  effect: { kind: ModKind; value: number }
  consumes?: Cost[]
  produces?: Cost[]
  idle: IdleRigDTO | null
  equip?: { slot: string; tag: string }
  unlocked: boolean
  affordable: boolean
  missing: Cost[]
  missingUnlocks: { skill: string; level: number }[]
  band: BandGate | null
  missingBands: BandGate[]
  success: number
  table?: { item: string; count?: number; weight: number }[]
  choices?: { id: string; label: string }[]
  choice: string
  equipOk: boolean
  equipMissing: { slot: string; tag: string } | null
}

interface TalentRequirement {
  skill: string
  level: number
  met?: boolean
}

export interface TalentOption {
  id: string
  name: string
  description: string
  mods: { kind: ModKind; value: number; skill?: string; synergy?: string }[]
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
  options: TalentOption[]
}

interface MasteryPending {
  milestone: number
  options: TalentOption[]
}

interface SkillTalentDTO {
  pendingChoice: boolean
  milestone: number | null
  options: TalentOption[]
  nextMilestone: number | null
  owned: OwnedTalent[]
  synergy: {
    target: string
    name: string
    label: string
    taken: number[]
  }
  mastery: {
    milestones: number[]
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
  level: number
  xp: number
  progress: number
  effect: { kind: ModKind; value: number }
  effectLabel: string
  talent: SkillTalentDTO
  bands: BandDTO[]
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
  armour?: number
  power?: number
  armourType?: string
  combatStyle?: string
  itemLevel?: number
  stats?: Partial<GearStats>
  value?: number
}

interface ItemUse {
  kind: 'action' | 'enchant'
  skillId: string
  skillName: string
  actionId: string
  name: string
  count: number
}

interface ItemSource {
  kind: 'action' | 'monster'
  name: string
  icon: string
  skillId?: string
  skillName?: string
  actionId?: string
  monsterId?: string
  chance?: number
}

export interface ItemDetailDTO {
  item: ItemDTO
  usedIn: ItemUse[]
  sources: ItemSource[]
  essence: { id: string; name: string; icon: string }
}

export type GearStatId =
  'strength' | 'agility' | 'intellect' | 'stamina' | 'haste' | 'crit' | 'mastery'

export interface GearStats {
  strength: number
  agility: number
  intellect: number
  stamina: number
  haste: number
  crit: number
  mastery: number
}

export interface GearInstanceDTO {
  id: string
  itemId: string
  slot: string
  quality: 'common' | 'uncommon' | 'rare' | 'epic'
  stats: GearStats
  armour: number
  power: number
  gearScore: number
  equipped: boolean
  enchant: string[]
  requirements: Record<string, number>
  missing: GearRequirementDTO[]
}

interface GearRequirementDTO {
  skill: string
  name: string
  level: number
  current: number
}

export interface EquippedDTO {
  slot: string
  itemId: string
  instanceId: string | null
}

export interface GearSetDTO {
  id: string
  name: string
  combatStyle: 'melee' | 'ranged' | 'magic' | 'general'
  slots: Record<string, { itemId: string; instanceId: string | null }>
  createdAt: number
  updatedAt: number
}

interface SetBonusTierDTO {
  pieces: number
  label: string
  stats?: Partial<GearStats>
  armourPct?: number
  powerPct?: number
}

export interface ActiveSetBonusDTO {
  id: string
  name: string
  armourType: string
  pieces: number
  active: SetBonusTierDTO[]
  next: SetBonusTierDTO | null
}

type DistillMode = 'max-value' | 'min-value'

export interface DistillConfigDTO {
  mode: DistillMode
  allow: string[]
}

export interface GearResponse {
  equipment: EquippedDTO[]
  gear: GearInstanceDTO[]
  sets: GearSetDTO[]
  setBonuses: ActiveSetBonusDTO[]
  bands: BandDTO[]
  enchants: EnchantDTO[]
  enchantingLevel: number
  distill: DistillConfigDTO
  buffs: { band: BandBuffs }
  items: ItemDTO[]
  inventory: { itemId: string; count: number }[]
}

interface GearSetSkipDTO {
  slot: string
  itemId: string
  name: string
  missing: GearRequirementDTO[]
}

export interface GearSetApplyResponse extends GearResponse {
  skipped: GearSetSkipDTO[]
}

export interface RigsSummary {
  maxLive: number
  live: number
}

export interface SkillsResponse extends GearResponse {
  skills: SkillDTO[]
  items: ItemDTO[]
  inventory: { itemId: string; count: number }[]
  bonuses: { globalXp: number; damage: number; drop: number; hp: number }
  rigs: RigsSummary
}

interface FedBy {
  skillId: string
  name: string
  label: string
  taken: number[]
}

export interface SkillPageResponse extends GearResponse {
  skill: SkillDTO
  fedBy: FedBy[]
  items: ItemDTO[]
  sources: Record<string, { skillId: string; actionId: string }>
  inventory: { itemId: string; count: number }[]
  bonuses: { globalXp: number; damage: number; drop: number; hp: number }
  rigs: RigsSummary
}

export interface StopRigResponse extends GearResponse {
  ok: boolean
  skills: SkillDTO[]
  rigs: RigsSummary
}

export interface SkillOutcome {
  actionId: string
  skillId: string
  xp: number
  level: number | null
  skillLevel: number | null
  leveledUp: boolean
  gained: Cost[]
  consumed: Cost[]
  idle: IdleRigDTO | null
  idleXp: number
  rigsRunning?: number
  maxLiveRigs?: number
  stoppedRig?: { actionId: string; name: string; skillId: string } | null
  talentUnlocked: number | null
}
