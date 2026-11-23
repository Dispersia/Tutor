/**
 * `POST /api/decks/:id/pitch` — backfill pitch-accent metadata (docs/DESIGN.md
 * §11.1). The bundled dictionary answers first (offline); the generator fills the
 * rest. With `{ force: true }` every card with a reading is re-annotated from the
 * dictionary alone, replacing wrong contours without asking the model.
 */

import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { getDeck, getRoles, listCards } from '../../db/repo'
import {
  backfillDeckPitch,
  composeFetchers,
  dictionaryFetcher,
  llmPitchFetcher,
  pitchTargets,
  type PitchFetcher,
} from '../../deck/pitch'
import { roleReasoning } from '../../env'
import { OpenRouter } from '../../llm/openrouter'
import { resolveUserKey } from '../../llm/userkey'

export function registerDeckPitch(app: App) {
  app.post('/api/decks/:id/pitch', (c) => pitchHandler(c))
}

async function pitchHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = String(c.req.param('id'))
  const deck = getDeck(deps.db, deckId, user.id)
  if (!deck) return c.json({ error: 'not found' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
  const force = body.force === true
  const cards = listCards(deps.db, user.id, deckId)
  if (pitchTargets(cards, { force }).length === 0) {
    return c.json({ updated: 0, total: cards.length })
  }
  const fetcher = await pitchFetcherFor(deps, user.id, deck.targetLang, { dictionaryOnly: force })
  if (!fetcher) return c.json({ error: 'No OpenRouter key — add one in Settings.' }, 502)
  return backfill({ c, deps, userId: user.id, deckId, fetcher, force })
}

interface BackfillReq {
  c: Context<AppEnv>
  deps: Deps
  userId: string
  deckId: string
  fetcher: PitchFetcher
  force: boolean
}

async function backfill(req: BackfillReq) {
  try {
    return req.c.json(
      await backfillDeckPitch(req.deps.db, req.userId, req.deckId, req.fetcher, {
        force: req.force,
      }),
    )
  } catch (err) {
    return req.c.json({ error: (err as Error).message }, 502)
  }
}

/**
 * The pitch annotator for this user: the bundled Japanese dictionary first, and
 * the generator model for whatever the dictionary does not know. With
 * `dictionaryOnly` the model is skipped entirely, so a re-annotation is
 * deterministic and needs no key.
 */
async function pitchFetcherFor(
  deps: Deps,
  userId: string,
  targetLang: string,
  opts: { dictionaryOnly?: boolean } = {},
): Promise<PitchFetcher | undefined> {
  const dictionary = dictionaryFetcher(targetLang)
  if (deps.pitch) return composeFetchers(dictionary, deps.pitch)
  if (opts.dictionaryOnly) return dictionary
  const key = await resolveUserKey(deps, userId)
  if (!key) return targetLang === 'ja' ? dictionary : undefined
  return composeFetchers(dictionary, llmAnnotator(deps, userId, key, targetLang))
}

function llmAnnotator(deps: Deps, userId: string, key: string, targetLang: string): PitchFetcher {
  return llmPitchFetcher(
    new OpenRouter(key, deps.or.baseUrl),
    getRoles(deps.db, userId, deps.defaults).generator,
    roleReasoning.generator,
    targetLang,
  )
}
