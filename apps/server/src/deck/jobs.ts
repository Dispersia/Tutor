import type { UserId, DeckId } from '../ids'
import { updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import type { Planner } from './plan'
import { fillDeck, type FillDeckOptions } from './build'
import type { DeckContext } from './context'
import { trackDeckJob } from './builds'

export { awaitDeckBuild, isDeckBuilding, trackDeckJob } from './builds'

export interface StartDeckBuildRequest {
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
  base?: { cursorStart?: number; total?: number; onFinish?: () => void }
}

export function startDeckBuild(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  request: StartDeckBuildRequest,
): void {
  const base = request.base ?? {}
  const range = { start: base.cursorStart ?? 0, total: base.total ?? request.opts.count }
  const run = runBuild(db, userId, deckId, request, range)
  trackDeckJob(
    deckId,
    run.finally(() => base.onFinish?.()),
  )
}

interface Range {
  start: number
  total: number
}

async function runBuild(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  request: StartDeckBuildRequest,
  range: Range,
): Promise<void> {
  const { ctx, opts, planner } = request
  const onProgress = progressWriter({ db, deckId, userId, opts, ...range })
  try {
    await fillDeck(db, userId, deckId, { ctx, opts: { ...opts, onProgress }, planner })
    updateDeckSettings(db, deckId, builtSettings(range, opts.count))
  } catch (err) {
    updateDeckSettings(db, deckId, { building: false, buildError: (err as Error).message })
  }
}

function builtSettings(range: Range, count: number) {
  return {
    building: false,
    cursor: range.start + count,
    buildTotal: range.total,
    buildError: undefined,
  }
}

interface ProgressReq {
  db: Db
  deckId: DeckId
  userId: UserId
  opts: FillDeckOptions
  start: number
  total: number
}

function progressWriter(req: ProgressReq) {
  return (built: number, chunkTotal: number) => {
    req.opts.onProgress?.(built, chunkTotal)
    updateDeckSettings(req.db, req.deckId, {
      cursor: req.start + built,
      buildTotal: req.total,
    })
  }
}
