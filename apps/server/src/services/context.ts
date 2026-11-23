/** Per-request learner state (docs/REFACTOR_PLAN.md §7, finding 1). */

import { listCards } from '../db/repo'
import type { Db } from '../db/client'
import { srsStateMap, type LoadedCards } from './srs'

/**
 * Loads the expensive per-user maps once for a request, so a handler that needs
 * cards + SRS state scans each store once instead of once per helper. Pass the
 * result to `studyBudget` / `knownWords`.
 */
export function loadLearnerData(db: Db, userId: string): LoadedCards {
  return { cards: listCards(db, userId), srs: srsStateMap(db, userId) }
}
