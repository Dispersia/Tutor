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
  distillPerCraft,
  gearSetsView,
  gearView,
  getDistillConfig,
  idleView,
  inventoryView,
  loadoutSetBonuses,
  loadPlayerCtx,
  loadProgress,
  skillLevelOf,
  type PlayerCtx,
} from '../../services'
import type { Deps } from '../../context'

export type SkillView = ReturnType<typeof skillView>
export type Board = ReturnType<typeof boardSkills>

interface BoardData extends PlayerCtx {
  db: Deps['db']
  userId: UserId
  bandById: Map<BandId, ReturnType<typeof bandView>[number]>
  bandLevels: Map<BandId, number>
}

export function boardSkills(deps: Deps, userId: UserId, ctx?: PlayerCtx) {
  const data = boardData(deps, userId, ctx ?? loadPlayerCtx(deps.db, deps.events, userId))
  return {
    skills: SKILLS.map((s) => skillView(s, data)),
    rigs: { maxLive: MAX_LIVE_RIGS, live: liveRigCount(data.settled.rigs, data.now) },
  }
}

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

function bandsOf(actions: ActionDef[], d: BoardData) {
  const ids = actions.map((a) => a.band).filter((b): b is BandId => Boolean(b))
  const bands = [...new Set(ids)].map((b) => d.bandById.get(b))
  return bands.filter((b): b is NonNullable<typeof b> => Boolean(b))
}

function actionView(a: ActionDef, s: SkillDef, d: BoardData) {
  const ap = d.byAction.get(a.id)
  const rig = d.settled.rigs.get(a.id)
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

function recipeView(a: ActionDef, choiceId: string | undefined) {
  return {
    consumes: actionConsumes(a, choiceId),
    produces: actionChoice(a, choiceId)?.produces ?? a.produces,
    table: actionChoice(a, choiceId)?.table ?? a.table,
  }
}

function rigView(a: ActionDef, d: BoardData, rig: RigState | undefined) {
  if (!rig) return null
  const xpPerCraft = a.id === 'distill' ? distillPerCraft(d.db, d.userId) : undefined
  return idleView(rig, a, d.now, d.bonuses.yield(a.id) + d.bonuses.double(a.id), xpPerCraft)
}

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

function equippedView(deps: Deps, userId: UserId) {
  return listEquipment(deps.db, userId).map((e) => ({
    slot: e.slot,
    itemId: e.itemId,
    instanceId: e.instanceId ?? null,
  }))
}

export function gearPayload(deps: Deps, userId: UserId, ctx?: Pick<PlayerCtx, 'levels' | 'bands'>) {
  const levels = ctx?.levels ?? loadProgress(deps.db, userId).levels
  const bands = ctx?.bands ?? bandView(deps.db, userId)
  return {
    equipment: equippedView(deps, userId),
    gear: gearView(deps.db, userId, levels),
    sets: gearSetsView(deps.db, userId),
    setBonuses: loadoutSetBonuses(deps.db, userId),
    bands,
    enchants: ENCHANTS,
    enchantingLevel: skillLevelOf(deps.db, userId, 'enchanting', levels),
    distill: getDistillConfig(deps.db, userId),
    buffs: { band: accountBandBonuses(deps.db, userId) },
    items: ITEMS.map((i) => ({ ...i, value: itemValue(i) })),
    inventory: inventoryView(deps.db, userId),
  }
}

export function itemSources(): Record<string, { skillId: SkillId; actionId: string }> {
  const out: Record<string, { skillId: SkillId; actionId: string }> = {}
  for (const a of ACTIONS) {
    for (const p of a.produces ?? []) {
      if (!out[p.item]) out[p.item] = { skillId: a.skillId, actionId: a.id }
    }
  }
  return out
}
