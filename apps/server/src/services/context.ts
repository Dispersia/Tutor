import type { UserId } from '../ids'
import { listCards } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import type { Bonuses } from '../game/modifiers'
import { srsStateMap, type LoadedCards } from './srs'
import { settleRigs } from './idle'
import { actionLevelInfo } from '../game/skills'
import { actionProgressView, skillSummaries, type ActionProgress } from './board'
import { bandView } from './bands'
import { talentView } from './talents'
import { aggregateBonuses, type ProgressCtx } from './progress'

export function loadLearnerData(db: Db, userId: UserId): LoadedCards {
  return { cards: listCards(db, userId), srs: srsStateMap(db, userId) }
}

export interface PlayerCtx {
  now: number
  settled: ReturnType<typeof settleRigs>
  byAction: Map<string, ActionProgress>
  levels: Map<string, number>
  bands: ReturnType<typeof bandView>
  progress: Map<string, ReturnType<typeof skillSummaries>[number]>
  talents: Map<string, ReturnType<typeof talentView>[number]>
  bonuses: Bonuses
}

export function loadPlayerCtx(db: Db, bus: EventBus, userId: UserId, now = Date.now()): PlayerCtx {
  const byAction = actionProgressView(db, userId)
  const pre = settleState(db, userId, byAction)
  const settled = settleRigs(db, bus, userId, now, pre)
  applyAwards(byAction, settled.awards)
  const levels = actionLevels(byAction)
  return {
    now,
    settled,
    byAction,
    levels,
    bands: bandView(db, userId, byAction),
    progress: new Map(skillSummaries(db, userId, byAction).map((s) => [s.skillId, s])),
    talents: new Map(talentView(db, userId, levels).map((t) => [t.skillId, t])),
    bonuses: settled.awards.size ? aggregateBonuses(db, userId, levels) : pre.bonuses,
  }
}

function settleState(db: Db, userId: UserId, byAction: Map<string, ActionProgress>): ProgressCtx {
  const levels = actionLevels(byAction)
  return { levels, bonuses: aggregateBonuses(db, userId, levels) }
}

function applyAwards(byAction: Map<string, ActionProgress>, awards: Map<string, number>): void {
  for (const [actionId, xp] of awards) {
    byAction.set(actionId, { actionId, xp, ...actionLevelInfo(xp) })
  }
}

function actionLevels(byAction: Map<string, ActionProgress>): Map<string, number> {
  return new Map([...byAction].map(([id, p]) => [id, p.level]))
}
