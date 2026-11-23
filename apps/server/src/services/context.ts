/** The per-request state a board/player view reads (docs/ARCHITECTURE.md). */

import { listCards } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import type { Bonuses } from '../game/modifiers'
import { srsStateMap, type LoadedCards } from './srs'
import { settleRigs } from './idle'
import { actionProgressView, skillSummaries, type ActionProgress } from './board'
import { bandView } from './bands'
import { talentView } from './talents'
import { aggregateBonuses } from './progress'

/**
 * Loads the expensive per-user maps once for a request, so a handler that needs
 * cards + SRS state scans each store once instead of once per helper. Pass the
 * result to `studyBudget` / `knownWords`.
 */
export function loadLearnerData(db: Db, userId: string): LoadedCards {
  return { cards: listCards(db, userId), srs: srsStateMap(db, userId) }
}

/** Every map a board or player view reads, loaded once for a request. */
export interface PlayerCtx {
  now: number
  settled: ReturnType<typeof settleRigs>
  byAction: Map<string, ActionProgress>
  levels: Map<string, number>
  bands: ReturnType<typeof bandView>
  /** profession summaries, by skill id */
  progress: Map<string, ReturnType<typeof skillSummaries>[number]>
  /** talent trees, by skill id */
  talents: Map<string, ReturnType<typeof talentView>[number]>
  bonuses: Bonuses
}

/**
 * Loads the per-request player state once: the settled idle rigs, the action map,
 * the bands, the profession/talent views and the bonuses derived from that same
 * map. Board and gear handlers share one, so a render reads each store once
 * instead of once per view (docs/ARCHITECTURE.md).
 */
export function loadPlayerCtx(db: Db, bus: EventBus, userId: string, now = Date.now()): PlayerCtx {
  const settled = settleRigs(db, bus, userId, now)
  const byAction = actionProgressView(db, userId)
  const levels = actionLevels(byAction)
  const bands = bandView(db, userId)
  return {
    now,
    settled,
    byAction,
    levels,
    bands,
    progress: new Map(skillSummaries(db, userId, byAction).map((s) => [s.skillId, s])),
    talents: new Map(talentView(db, userId).map((t) => [t.skillId, t])),
    bonuses: aggregateBonuses(db, userId, levels),
  }
}

/** The action-level map, from an action-progress map already in hand. */
export function actionLevels(byAction: Map<string, ActionProgress>): Map<string, number> {
  return new Map([...byAction].map(([id, p]) => [id, p.level]))
}
