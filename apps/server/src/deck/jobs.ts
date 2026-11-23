/** Background deck builds: the in-flight map and the runner. */

import { updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import type { Planner } from './plan'
import { fillDeck, type FillDeckOptions } from './build'
import type { DeckContext } from './context'

/**
 * In-flight background builds, keyed by deck id, so a caller (or a test) can
 * wait for the work the HTTP response did not. Entries clear when they finish.
 */
const builds = new Map<string, Promise<void>>()

/** Waits for a deck's background build, resolving at once when none is running. */
export function awaitDeckBuild(deckId: string): Promise<void> {
  return builds.get(deckId) ?? Promise.resolve()
}

/**
 * Fills a deck in the background. The HTTP handler returns as soon as the deck
 * exists, and this keeps generating cards in batches, writing the growth cursor
 * after each one so the UI can watch the deck fill. The `building` flag is the
 * learner-visible status; it clears on success or error (and a restart clears
 * it too — see `clearDeckBuilds`).
 *
 * `base` places the run inside the deck's source list — an import starts at 0,
 * a resume continues from the cursor it stopped at. `base.onFinish` runs after
 * the run settles (success or error), e.g. to queue the deck's audio recording.
 */
/** One background run: the deck's rules, the words to fill and its progress base. */
export interface StartDeckBuildRequest {
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
  base?: { cursorStart?: number; total?: number; onFinish?: () => void }
}

export function startDeckBuild(
  db: Db,
  userId: string,
  deckId: string,
  request: StartDeckBuildRequest,
): void {
  const { ctx, opts, planner, base = {} } = request
  const start = base.cursorStart ?? 0
  const total = base.total ?? opts.count
  const run = (async () => {
    try {
      await fillDeck(db, userId, deckId, {
        ctx,
        opts: {
          ...opts,
          onProgress: (built, chunkTotal) => {
            opts.onProgress?.(built, chunkTotal)
            updateDeckSettings(db, deckId, userId, { cursor: start + built, buildTotal: total })
          },
        },
        planner,
      })
      updateDeckSettings(db, deckId, userId, {
        building: false,
        cursor: start + opts.count,
        buildTotal: total,
        buildError: undefined,
      })
    } catch (err) {
      updateDeckSettings(db, deckId, userId, {
        building: false,
        buildError: (err as Error).message,
      })
    } finally {
      builds.delete(deckId)
      base.onFinish?.()
    }
  })()
  builds.set(deckId, run)
}
