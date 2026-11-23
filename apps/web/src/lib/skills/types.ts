/**
 * The skills/gear wire model (docs/DESIGN.md §13.5). Types only, so a component
 * can import one DTO without pulling the API client. The matching `fetch`
 * wrappers live in `client.ts`.
 */

import type { ModKind } from '../types'

export interface Cost {
  item: string
  count: number
}

/** A material tier band (docs/DESIGN.md §13.5.3). */
export type BandId = 'bronze' | 'iron' | 'steel' | 'mythril' | 'adamant'

/** One band's unlock requirement against an action, or the action's own band gate. */
export interface BandGate {
  id: BandId
  name: string
  /** the level asked for */
  level: number
  /** the player's current band score */
  current: number
}

/** A band and its shared score, for the artisan board. */
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
  /** the level a band's gear is fully unlocked by; the band still runs to 100 */
  gearUnlockLevel: number
  buffLabel: string
  /** which stat the band's passive grows */
  buffStat: 'crit' | 'haste' | 'mastery' | 'stamina' | 'lifesteal'
  /** the account-wide bonus this band grants right now (fraction/flat by stat) */
  buffValue: number
  enchantLabel: string
  /** Enchanting level needed to spend this band's reagent */
  enchantLevel: number
  gearTotal: number
  gearUnlocked: number
  /** the next gear this band unlocks */
  nextUnlock: { level: number; name: string } | null
}

/** Combat buffs from tier bands (§13.5.3). */
export interface BandBuffs {
  crit: number
  haste: number
  mastery: number
  stamina: number
  lifesteal: number
}

/** One catalog enchant (§13.5.3.2): fits a slot, costs essence reagents. */
export interface EnchantDTO {
  id: string
  name: string
  slot: string
  stat: string
  value: number
  level: number
  reagents: Cost[]
}

/** Compact label for a profession's passive, so a value reads as a meaning. */
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
  /** the run-length cap (seconds): the longest a run can ever get */
  maxRunSec: number
  /** completions at which a run reaches `maxRunSec` — the end of the climb */
  runFullAtCompletions: number
  /** how far the rig is toward the cap: 0 → 1 */
  runProgress: number
  /** whether the run has reached the cap — the rig is as good as it gets */
  maxed: boolean
  /** seconds between items right now (tier-scaled) */
  intervalSec: number
  /** fraction already baked into a run (yield + double) */
  yieldBonus: number
  /** action XP each craft hands over while the run is live (base, before talents) */
  xpPerCraft: number
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
  /** the band this action feeds and the level it unlocks at (§13.5.3) */
  band: BandGate | null
  /** cross-band gates not yet met (e.g. iron needs Bronze 40) */
  missingBands: BandGate[]
  /** chance this action yields its output (1 = always); a prospect can miss */
  success: number
  /** a weighted gem table — a prospect rolls one entry instead of fixed `produces` */
  table?: { item: string; count?: number; weight: number }[]
  /** recipes this action lets you choose between (prospect any ore, cut any gem) */
  choices?: { id: string; label: string }[]
  /** the currently selected recipe ('' = the first choice) */
  choice: string
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
  /** material bands this profession's actions feed (empty for non-artisans) */
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
  /** gear metadata (present on equipment) */
  armour?: number
  power?: number
  armourType?: string
  combatStyle?: string
  itemLevel?: number
  stats?: Partial<GearStats>
  /** coin value (§13.5.3.2) — drives Distill XP and selling */
  value?: number
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
  /** enchant tokens on this piece: a band id, or `gem:<type>` (§13.5.3.1) */
  enchant: string[]
  /** Stat levels needed to wear this piece. */
  requirements: Record<string, number>
  /** Requirements the player does not meet yet (empty when wearable). */
  missing: GearRequirementDTO[]
}

export interface GearRequirementDTO {
  skill: string
  /** Human skill name, e.g. `Defence`. */
  name: string
  /** The level the piece demands. */
  level: number
  /** The player's current level in that skill. */
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

export interface SetBonusTierDTO {
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

export interface GearResponse {
  equipment: EquippedDTO[]
  gear: GearInstanceDTO[]
  sets: GearSetDTO[]
  setBonuses: ActiveSetBonusDTO[]
  bands: BandDTO[]
  /** the enchant catalog, grouped by slot (§13.5.3.2) */
  enchants: EnchantDTO[]
  /** the player's Enchanting level, to gate enchants in the UI */
  enchantingLevel: number
  buffs: { band: BandBuffs }
  items: ItemDTO[]
  inventory: { itemId: string; count: number }[]
}

/** A saved-set piece the player cannot wear yet. */
export interface GearSetSkipDTO {
  slot: string
  itemId: string
  name: string
  missing: GearRequirementDTO[]
}

export interface GearSetApplyResponse extends GearResponse {
  skipped: GearSetSkipDTO[]
}

/** The live-rig cap readout (§13.5.1): how many machines may run at once. */
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

/** One cross-training edge: a talent in `skillId` that feeds this profession. */
export interface FedBy {
  skillId: string
  name: string
  /** the talent's name, e.g. "Deep Veins" */
  label: string
  /** milestones where the feeder owns that talent (empty → nothing is fed) */
  taken: number[]
}

export interface SkillPageResponse extends GearResponse {
  skill: SkillDTO
  /** professions whose synergy talent feeds this one (the reverse edge of the web) */
  fedBy: FedBy[]
  items: ItemDTO[]
  /** where each material is produced: itemId → the action that makes it */
  sources: Record<string, { skillId: string; actionId: string }>
  inventory: { itemId: string; count: number }[]
  bonuses: { globalXp: number; damage: number; drop: number; hp: number }
  rigs: RigsSummary
}

export interface StopRigResponse extends GearResponse {
  /** whether a live run was actually stopped */
  ok: boolean
  skills: SkillDTO[]
  rigs: RigsSummary
}

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
  /** XP the running rigs earned on their own since the last settle */
  idleXp: number
  /** rigs alive right now, after the live-rig cap (§13.5.1); absent on a failed drill */
  rigsRunning?: number
  /** how many rigs may run at once */
  maxLiveRigs?: number
  /** the rig this drill pushed over the cap and stopped, if any */
  stoppedRig?: { actionId: string; name: string; skillId: string } | null
  /** the profession milestone whose talent choice just opened (or null) */
  talentUnlocked: number | null
}
