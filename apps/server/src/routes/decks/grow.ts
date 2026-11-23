/**
 * `POST /api/decks/:id/grow` — grow a deck another n+1 batch, or (with
 * `{ all: true }`) finish it, resuming after a stopped build (docs/DESIGN.md §13.7).
 */

import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getDeck } from '../../db/repo'
import { growDeck, isDeckBuilding, startDeckGrowth } from '../../deck/generate'
import { plannerFor } from '../../deck/planner'
import type { Planner } from '../../deck/plan'
import { bool, jsonBody, num, str } from '../body'
import { deckView } from './view'

interface GrowBody {
  topic?: string
  count?: number
  all: boolean
}

/** Reads a grow request: a topic, a batch size, and whether to finish the deck. */
function growBody(body: Record<string, unknown>): GrowBody {
  return { topic: str(body, 'topic'), count: num(body, 'count'), all: bool(body, 'all') === true }
}

interface GrowReq {
  c: Context<AppEnv>
  deps: Deps
  deckId: string
  body: GrowBody
  planner: Planner
}

/** Decks with a grow request in flight (a background build is tracked by `deck/jobs`). */
const growing = new Set<string>()

export function registerDeckGrow(app: App) {
  app.post('/api/decks/:id/grow', (c) => growHandler(c))
}

async function growHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = String(c.req.param('id'))
  if (!getDeck(deps.db, deckId, user.id)) return c.json({ error: 'not found' }, 404)
  const body = growBody(await jsonBody(c))
  const planner = await plannerFor(deps, user.id)
  if (!planner) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  // Two runs over one deck plan the same words twice and race the cursor.
  if (growing.has(deckId) || isDeckBuilding(deckId)) {
    return c.json({ error: 'This deck is already being built.' }, 409)
  }
  const req = { c, deps, deckId, body, planner }
  growing.add(deckId)
  try {
    return await (body.all ? finishDeck(req) : growOnce(req))
  } finally {
    growing.delete(deckId)
  }
}

/** One n+1 batch: a handful of new words and the sentences that weave them in. */
async function growOnce(req: GrowReq) {
  const { deps, deckId, body, planner } = req
  const user = req.c.get('user')!
  try {
    const built = await growDeck(deps.db, user.id, deckId, {
      topic: body.topic,
      count: body.count,
      fetcher: deps.fetcher,
      planner,
    })
    deps.audio?.enqueueDeck(user.id, deckId)
    return req.c.json({ deck: deckView(getDeck(deps.db, deckId, user.id)!), ...built })
  } catch (err) {
    return req.c.json({ error: (err as Error).message }, 502)
  }
}

/** Every remaining word, generated in the background (resumes a stopped build). */
async function finishDeck(req: GrowReq) {
  const { deps, deckId, body } = req
  const user = req.c.get('user')!
  try {
    const remaining = await startDeckGrowth(deps.db, user.id, deckId, {
      topic: body.topic,
      fetcher: deps.fetcher,
      planner: req.planner,
      onFinish: () => deps.audio?.enqueueDeck(user.id, deckId),
    })
    return req.c.json(finishReply(deps, user.id, deckId, remaining), 202)
  } catch (err) {
    return req.c.json({ error: (err as Error).message }, 502)
  }
}

function finishReply(deps: Deps, userId: string, deckId: string, remaining?: number) {
  const left = remaining ?? 0
  return {
    deck: deckView(getDeck(deps.db, deckId, userId)!),
    remaining: left,
    building: left > 0,
    newWords: [],
  }
}
