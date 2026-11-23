/**
 * Settling a completed action drill: the action gate and the idle-rig economy
 * (docs/DESIGN.md §13.5, §13.5.1). The route only hands the grade over.
 */

import type { AppEnv, Deps } from '../../context'
import { ACTION_BY_ID, type ActionDef } from '../../game/skills'
import { actionState, awardActionXp, completeAction } from '../../services'

/** The action/recipe a request names (a drill can settle one). */
export interface ActionRequest {
  actionId?: string
  /** the recipe choice for a choose-input action (prospect/cut) */
  choiceId?: string
}

/** An error a guard returns before the handler runs its use case. */
export type GuardError = { status: 403 | 404 | 409; body: Record<string, unknown> }

/** The action the request names, gated for unlock and affordability. */
export function actionGate(
  deps: Deps,
  userId: string,
  body: ActionRequest,
): { action?: ActionDef; error?: GuardError } {
  const action = body.actionId ? ACTION_BY_ID.get(body.actionId) : undefined
  if (body.actionId && !action) return { error: { status: 404, body: { error: 'unknown action' } } }
  if (!action) return {}
  return gateAction(deps, userId, action, body.choiceId)
}

function gateAction(
  deps: Deps,
  userId: string,
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
  return {
    status: 403,
    body: {
      error: 'action locked',
      missingUnlocks: state.missingUnlocks,
      missingBands: state.missingBands,
      equipMissing: state.equipMissing,
    },
  }
}

function missingMaterials(state: ActionState): GuardError {
  return { status: 409, body: { error: 'missing materials', missing: state.missing } }
}

/** Applies action XP + the idle-rig economy for a completed action. */
export function settleAction(
  deps: AppEnv['Variables']['deps'],
  userId: string,
  actionId: string | undefined,
  result: { correct: boolean; score: number },
  choiceId?: string,
) {
  const action = actionId ? ACTION_BY_ID.get(actionId) : undefined
  if (!action) return null
  if (!struckTrue(action, result)) return failedAward(action)
  return runRig(deps, userId, action, choiceId)
}

/** A drill only lands when it is correct and clears the action's quality bar. */
function struckTrue(action: ActionDef, result: { correct: boolean; score: number }): boolean {
  return result.correct && result.score >= (action.minScore ?? 70)
}

/** The reply for a missed strike: no XP, no materials, no rig movement. */
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

/**
 * The drill powers the rig (docs/DESIGN.md §13.5.1): it pays every running rig
 * up to now, lands the strike, then makes this action's run faster and longer.
 * `gained` is the whole windfall — the strike plus what the runs made — and
 * `idleXp` is the XP those runs earned on their own while you were away.
 */
function runRig(
  deps: AppEnv['Variables']['deps'],
  userId: string,
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
