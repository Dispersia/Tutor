import { toDeckId, type UserId, type DeckId } from '../../ids'
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
import { bool, jsonBody } from '../body'
import { fail, needKey } from '../errors'

export function registerDeckPitch(app: App) {
  app.post('/api/decks/:id/pitch', (c) => pitchHandler(c))
}

async function pitchHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deckId = toDeckId(String(c.req.param('id')))
  const deck = getDeck(deps.db, deckId)
  if (!deck) return fail(c, 404, 'not found')
  const force = bool(await jsonBody(c), 'force') === true
  const cards = listCards(deps.db, user.id, deckId)
  if (pitchTargets(cards, { force }).length === 0) {
    return c.json({ updated: 0, total: cards.length })
  }
  const fetcher = await pitchFetcherFor(deps, user.id, deck.targetLang, { dictionaryOnly: force })
  if (!fetcher) return needKey(c)
  return backfill({ c, deps, userId: user.id, deckId, fetcher, force })
}

interface BackfillReq {
  c: Context<AppEnv>
  deps: Deps
  userId: UserId
  deckId: DeckId
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
    return fail(req.c, 502, (err as Error).message)
  }
}

async function pitchFetcherFor(
  deps: Deps,
  userId: UserId,
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

function llmAnnotator(deps: Deps, userId: UserId, key: string, targetLang: string): PitchFetcher {
  return llmPitchFetcher(
    new OpenRouter(key, deps.or.baseUrl),
    getRoles(deps.db, userId, deps.defaults).generator,
    roleReasoning.generator,
    targetLang,
  )
}
