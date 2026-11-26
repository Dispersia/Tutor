import { toDeckId, type UserId, type DeckId } from '../../ids'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getDeck } from '../../db/repo'
import { growDeck, isDeckBuilding, startDeckGrowth } from '../../deck/generate'
import { plannerFor, reviewerFor } from '../../deck/planner'
import type { Planner } from '../../deck/plan'
import type { Reviewer } from '../../deck/review'
import { bool, jsonBody, num, str } from '../body'
import { deckView } from './view'
import { fail, needKey } from '../errors'

interface GrowBody {
  topic?: string
  count?: number
  all: boolean
}

function growBody(body: Record<string, unknown>): GrowBody {
  return { topic: str(body, 'topic'), count: num(body, 'count'), all: bool(body, 'all') === true }
}

interface GrowReq {
  c: Context<AppEnv>
  deps: Deps
  deckId: DeckId
  body: GrowBody
  planner: Planner
  reviewer?: Reviewer
}

const growing = new Set<DeckId>()

export function registerDeckGrow(app: App) {
  app.post('/api/decks/:id/grow', (c) => growHandler(c))
}

async function growHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = toDeckId(String(c.req.param('id')))
  if (!getDeck(deps.db, deckId, user.id)) return fail(c, 404, 'not found')
  const body = growBody(await jsonBody(c))
  if (growing.has(deckId) || isDeckBuilding(deckId)) {
    return fail(c, 409, 'This deck is already being built.')
  }
  growing.add(deckId)
  try {
    const planner = await plannerFor(deps, user.id)
    if (!planner) return needKey(c)
    const reviewer = await reviewerFor(deps, user.id)
    const req = { c, deps, deckId, body, planner, reviewer }
    return await (body.all ? finishDeck(req) : growOnce(req))
  } finally {
    growing.delete(deckId)
  }
}

async function growOnce(req: GrowReq) {
  const { deps, deckId, body, planner, reviewer } = req
  const user = req.c.get('user')!
  try {
    const built = await growDeck(deps.db, user.id, deckId, {
      topic: body.topic,
      count: body.count,
      fetcher: deps.fetcher,
      planner,
      reviewer,
    })
    deps.audio?.enqueueDeck(user.id, deckId)
    return req.c.json({ deck: deckView(getDeck(deps.db, deckId)!), ...built })
  } catch (err) {
    return fail(req.c, 502, (err as Error).message)
  }
}

async function finishDeck(req: GrowReq) {
  const { deps, deckId, body } = req
  const user = req.c.get('user')!
  try {
    const remaining = await startDeckGrowth(deps.db, user.id, deckId, {
      topic: body.topic,
      fetcher: deps.fetcher,
      planner: req.planner,
      reviewer: req.reviewer,
      onFinish: () => deps.audio?.enqueueDeck(user.id, deckId),
    })
    return req.c.json(finishReply(deps, user.id, deckId, remaining), 202)
  } catch (err) {
    return fail(req.c, 502, (err as Error).message)
  }
}

function finishReply(deps: Deps, userId: UserId, deckId: DeckId, remaining?: number) {
  const left = remaining ?? 0
  return {
    deck: deckView(getDeck(deps.db, deckId)!),
    remaining: left,
    building: left > 0,
    newWords: [],
  }
}
