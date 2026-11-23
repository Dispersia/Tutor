import type { UserId } from '../../ids'
import type { AppEnv, Deps } from '../../context'
import { ACTION_BY_ID, type ActionDef } from '../../game/skills'
import { actionState, awardActionXp, completeAction } from '../../services'
import { guardError, type GuardError } from '../errors'

export interface ActionRequest {
  actionId?: string
  choiceId?: string
}

export type { GuardError }

export function actionGate(
  deps: Deps,
  userId: UserId,
  body: ActionRequest,
): { action?: ActionDef; error?: GuardError } {
  const action = body.actionId ? ACTION_BY_ID.get(body.actionId) : undefined
  if (body.actionId && !action) return { error: guardError(404, 'unknown action') }
  if (!action) return {}
  return gateAction(deps, userId, action, body.choiceId)
}

function gateAction(
  deps: Deps,
  userId: UserId,
  action: ActionDef,
  choiceId?: string,
): { action?: ActionDef; error?: GuardError } {
  const state = actionState(deps.db, userId, action, choiceId)
  if (!state.unlocked) return { error: lockedError(state) }
  if (!state.affordable) return { error: missingMaterials(state) }
  return { action }
}

type ActionState = ReturnType<typeof actionState>

function lockedError(state: ActionState): GuardError {
  return guardError(403, 'action locked', {
    missingUnlocks: state.missingUnlocks,
    missingBands: state.missingBands,
    equipMissing: state.equipMissing,
  })
}

function missingMaterials(state: ActionState): GuardError {
  return guardError(409, 'missing materials', { missing: state.missing })
}

export function settleAction(
  deps: AppEnv['Variables']['deps'],
  userId: UserId,
  actionId: string | undefined,
  result: { correct: boolean; score: number },
  choiceId?: string,
) {
  const action = actionId ? ACTION_BY_ID.get(actionId) : undefined
  if (!action) return null
  if (!struckTrue(action, result)) return failedAward(action)
  return runRig(deps, userId, action, choiceId)
}

function struckTrue(action: ActionDef, result: { correct: boolean; score: number }): boolean {
  return result.correct && result.score >= (action.minScore ?? 70)
}

function failedAward(action: ActionDef) {
  return {
    actionId: action.id,
    skillId: action.skillId,
    xp: 0,
    level: null,
    skillLevel: null,
    leveledUp: false,
    gained: [],
    consumed: [],
    idle: null,
    idleXp: 0,
    talentUnlocked: null,
  }
}

function runRig(
  deps: AppEnv['Variables']['deps'],
  userId: UserId,
  action: ActionDef,
  choiceId?: string,
) {
  const award = awardActionXp(deps.db, deps.events, userId, {
    actionId: action.id,
    amount: action.xp,
  })
  const rig = completeAction(deps.db, deps.events, userId, {
    actionId: action.id,
    now: Date.now(),
    choiceId,
  })
  return { ...awardSummary(award), ...rigSummary(rig) }
}

function awardSummary(award: ReturnType<typeof awardActionXp>) {
  return {
    actionId: award.actionId,
    skillId: award.skillId,
    xp: award.gained,
    level: award.level,
    skillLevel: award.skillLevel,
    leveledUp: award.leveledUp,
    talentUnlocked: award.talentUnlocked,
  }
}

function rigSummary(rig: ReturnType<typeof completeAction>) {
  return {
    gained: rig.gained,
    consumed: rig.consumed,
    idle: rig.idle,
    idleXp: rig.xp,
    rigsRunning: rig.rigsRunning,
    maxLiveRigs: rig.maxLiveRigs,
    stoppedRig: rig.stoppedRig,
  }
}
