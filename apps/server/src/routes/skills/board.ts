/**
 * The profession board (docs/DESIGN.md §13.5). This module only builds views: it
 * settles the idle rigs on read, then folds the loaded maps into the skills,
 * actions, bands and gear the client renders.
 */

import type { UserId } from '../../ids'
import {
  ACTIONS,
  ENCHANTS,
  ITEMS,
  SKILLS,
  actionChoice,
  actionConsumes,
  actionOdds,
  actionsForSkill,
  itemValue,
  skillXpForLevel,
  type ActionDef,
  type ModKind,
  type SkillDef,
  type SkillId,
} from '../../game/skills'
import { MAX_LIVE_RIGS, liveRigCount, type RigState } from '../../game/idle'
import type { BandId } from '../../game/bands'
import type { Bonuses } from '../../game/modifiers'
import { listEquipment } from '../../db/repo'
import {
  accountBandBonuses,
  actionState,
  bandView,
  gearSetsView,
  gearView,
  idleView,
  inventoryView,
  loadoutSetBonuses,
  loadPlayerCtx,
  loadProgress,
  skillLevelOf,
  type PlayerCtx,
} from '../../services'
import type { Deps } from '../../context'

/** The views the board builds, re-used by the single-profession page. */
export type SkillView = ReturnType<typeof skillView>
export type Board = ReturnType<typeof boardSkills>

/** The shared request maps plus the one lookup only the board derives. */
interface BoardData extends PlayerCtx {
  db: Deps['db']
  userId: UserId
  bandById: Map<BandId, ReturnType<typeof bandView>[number]>
  bandLevels: Map<BandId, number>
}

/**
 * Every profession with its derived level, and each action with its own level and
 * current passive. Idle rigs settle here, on read (docs §13.5.1): the bank is
 * credited for whatever every running machine made since the last request, so the
 * client always sees the truth. Pass the request's `PlayerCtx` to share the load
 * with `gearPayload` instead of scanning the stores again.
 */
export function boardSkills(deps: Deps, userId: UserId, ctx?: PlayerCtx) {
  const data = boardData(deps, userId, ctx ?? loadPlayerCtx(deps.db, deps.events, userId))
  return {
    skills: SKILLS.map((s) => skillView(s, data)),
    rigs: { maxLive: MAX_LIVE_RIGS, live: liveRigCount(data.settled.rigs, data.now) },
  }
}

/** The board's view data: the shared request maps plus the band lookup. */
function boardData(deps: Deps, userId: UserId, ctx: PlayerCtx): BoardData {
  return {
    ...ctx,
    db: deps.db,
    userId,
    bandById: new Map(ctx.bands.map((b) => [b.id, b])),
    bandLevels: new Map(ctx.bands.map((b) => [b.id, b.level])),
  }
}

function skillView(s: SkillDef, d: BoardData) {
  const p = d.progress.get(s.id)!
  const actions = actionsForSkill(s.id)
  return {
    ...s,
    level: p.level,
    xp: p.xp,
    progress: p.progress,
    talent: d.talents.get(s.id)!,
    bands: bandsOf(actions, d),
    actions: actions.map((a) => actionView(a, s, d)),
  }
}

/** The bands this profession's actions feed (Smithing's metal set, for now). */
function bandsOf(actions: ActionDef[], d: BoardData) {
  const ids = actions.map((a) => a.band).filter((b): b is BandId => Boolean(b))
  const bands = [...new Set(ids)].map((b) => d.bandById.get(b))
  return bands.filter((b): b is NonNullable<typeof b> => Boolean(b))
}

function actionView(a: ActionDef, s: SkillDef, d: BoardData) {
  const ap = d.byAction.get(a.id)
  const rig = d.settled.rigs.get(a.id)
  // A choose-the-recipe action's cost, odds and output follow its selection.
  const choiceId = rig?.choice || undefined
  return {
    ...a,
    level: ap?.level ?? 1,
    actionXp: ap?.xp ?? 0,
    intoLevel: ap?.intoLevel ?? 0,
    forNext: ap?.forNext ?? skillXpForLevel(1),
    progress: ap?.progress ?? 0,
    choice: choiceId ?? a.choices?.[0]?.id ?? '',
    ...recipeView(a, choiceId),
    success: actionOdds(a, choiceId, ap?.level ?? 1),
    effect: { ...s.effect, value: currentEffect(s.effect.kind, d.bonuses, a.id) },
    idle: rigView(a, d, rig),
    ...actionState(d.db, d.userId, a, choiceId, { levels: d.levels, bandLevels: d.bandLevels }),
  }
}

/** A choose-the-recipe action's own cost and output for the selected recipe. */
function recipeView(a: ActionDef, choiceId: string | undefined) {
  return {
    consumes: actionConsumes(a, choiceId),
    produces: actionChoice(a, choiceId)?.produces ?? a.produces,
    table: actionChoice(a, choiceId)?.table ?? a.table,
  }
}

/** The action's rig as the UI needs it, or null when it was never drilled. */
function rigView(a: ActionDef, d: BoardData, rig: RigState | undefined) {
  if (!rig) return null
  return idleView(rig, a, d.now, d.bonuses.yield(a.id) + d.bonuses.double(a.id))
}

/** The bonus an action carries right now (its own passive at its current level). */
export function currentEffect(kind: ModKind, b: Bonuses, actionId: string): number {
  switch (kind) {
    case 'yield':
      return b.yield(actionId)
    case 'double':
      return b.double(actionId)
    case 'xp':
      return b.xp(actionId)
    case 'coins':
      return b.coins(actionId)
    case 'global_xp':
      return b.globalXp
    case 'damage':
      return b.damage
    case 'drop':
      return b.drop
    case 'hp':
      return b.hp
  }
}

export function bonusSummary(b: Bonuses) {
  return { globalXp: b.globalXp, damage: b.damage, drop: b.drop, hp: b.hp }
}

/** The gear screen's payload: worn rows, rolled instances and saved sets. */
export function gearPayload(deps: Deps, userId: UserId, ctx?: Pick<PlayerCtx, 'levels' | 'bands'>) {
  const levels = ctx?.levels ?? loadProgress(deps.db, userId).levels
  const bands = ctx?.bands ?? bandView(deps.db, userId)
  return {
    equipment: listEquipment(deps.db, userId).map((e) => ({
      slot: e.slot,
      itemId: e.itemId,
      instanceId: e.instanceId ?? null,
    })),
    gear: gearView(deps.db, userId, levels),
    sets: gearSetsView(deps.db, userId),
    setBonuses: loadoutSetBonuses(deps.db, userId),
    bands,
    /** the enchant catalog, grouped by slot (§13.5.3.2) */
    enchants: ENCHANTS,
    /** the player's Enchanting level, to gate enchants in the UI */
    enchantingLevel: skillLevelOf(deps.db, userId, 'enchanting', levels),
    /** the account-wide passive from tier bands (§13.5.3) */
    buffs: { band: accountBandBonuses(deps.db, userId) },
    items: ITEMS.map((i) => ({ ...i, value: itemValue(i) })),
    inventory: inventoryView(deps.db, userId),
  }
}

/**
 * Where every material is produced: itemId → the action that makes it. A recipe's
 * "needs" cost can then link to the profession that supplies it (copper ore →
 * Mining · Mine copper). When several actions make the same thing, first wins.
 */
export function itemSources(): Record<string, { skillId: SkillId; actionId: string }> {
  const out: Record<string, { skillId: SkillId; actionId: string }> = {}
  for (const a of ACTIONS) {
    for (const p of a.produces ?? []) {
      if (!out[p.item]) out[p.item] = { skillId: a.skillId, actionId: a.id }
    }
  }
  return out
}
