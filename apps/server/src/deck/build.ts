import type { UserId, DeckId } from '../ids'
import { createDeck, updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import { fetchFrequencyWords, frequencySourceFor } from '../frequency/source'
import type { PlannedCard, Planner } from './plan'
import type { DeckSettings } from './settings'
import {
  applyDictionaryPitch,
  applyDictionaryReading,
  contextFrom,
  persistCards,
  type BuildDeckOptions,
  type BuiltDeck,
  type DeckContext,
} from './context'
import { DEFAULT_COUNT, MAX_DECK_WORDS, PLAN_CHUNK, clamp } from './instruction'
import { wordKey } from '../text/normalize'

export interface CreateDeckResult {
  deckId: DeckId
  name: string
  candidates: string[]
  sourceLabel: string
  count: number
}

interface WordSource {
  candidates: string[]
  label: string
  kind: 'frequency' | 'anki'
}

export async function createDeckForBuild(
  db: Db,
  userId: UserId,
  opts: BuildDeckOptions,
): Promise<CreateDeckResult> {
  const count = clamp(opts.count ?? DEFAULT_COUNT, 1, MAX_DECK_WORDS)
  const source = await resolveWords(opts, count)
  const name = opts.name?.trim() || `${opts.topic ?? opts.targetLang} · generated`
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Generated from ${source.label}`,
    settings: deckSettings(opts, count, source),
  })
  return { deckId: deck.id, name, candidates: source.candidates, sourceLabel: source.label, count }
}

async function resolveWords(opts: BuildDeckOptions, count: number): Promise<WordSource> {
  if (opts.words?.length) {
    return { candidates: opts.words, label: opts.sourceLabel ?? 'uploaded deck', kind: 'anki' }
  }
  const source = frequencySourceFor(opts.targetLang, opts.variant)
  if (!source) throw new Error(`no frequency list for language "${opts.targetLang}"`)
  const { words } = await fetchFrequencyWords(opts.targetLang, {
    variant: opts.variant,
    fetcher: opts.fetcher,
    source,
    limit: clamp(count + 200, 300, MAX_DECK_WORDS),
  })
  return { candidates: words.map((w) => w.word), label: source.label, kind: 'frequency' }
}

function deckSettings(opts: BuildDeckOptions, count: number, source: WordSource): DeckSettings {
  return {
    variant: opts.variant,
    readingScript: opts.readingScript,
    showReadings: opts.showReadings,
    disabledExercises: opts.disabledExercises,
    pitchAccent: opts.pitchAccent,
    cursor: 0,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: opts.instruction,
    wordSource: source.kind,
    words: source.kind === 'anki' ? source.candidates.slice(0, MAX_DECK_WORDS) : undefined,
  }
}

export interface FillDeckOptions {
  words: string[]
  count: number
  knownWords?: string[]
  startStep?: number
  onProgress?: (built: number, total: number) => void
}

export interface FillDeckResult {
  newWords: string[]
  cardCount: number
  built: number
}

export interface FillDeckRequest {
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
}

interface FillState {
  known: string[]
  future: Set<string>
  newWords: string[]
  cardCount: number
  step: number
  built: number
  chunkSize: number
}

function fillState(opts: FillDeckOptions): FillState {
  const known = [...(opts.knownWords ?? [])]
  const future = new Set(opts.words)
  for (const w of known) future.delete(w)
  return {
    known,
    future,
    newWords: [],
    cardCount: 0,
    step: opts.startStep ?? 0,
    built: 0,
    chunkSize: PLAN_CHUNK,
  }
}

export async function fillDeck(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  request: FillDeckRequest,
): Promise<FillDeckResult> {
  const { ctx, opts, planner } = request
  const total = clamp(opts.count, 0, opts.words.length)
  const state = fillState(opts)
  const batchReq: BatchReq = { db, userId, deckId, ctx, opts, planner, state, total }
  while (state.built < total) await oneBatch(batchReq)
  return { newWords: state.newWords, cardCount: state.cardCount, built: state.built }
}

interface BatchReq {
  db: Db
  userId: UserId
  deckId: DeckId
  ctx: DeckContext
  opts: FillDeckOptions
  planner: Planner
  state: FillState
  total: number
}

async function oneBatch(req: BatchReq) {
  const { state, total } = req
  const size = Math.min(state.chunkSize, total - state.built)
  const words = req.opts.words.slice(state.built, state.built + size)
  const planned = await planChunk(req.planner, req.ctx, words, state, size)
  if (!planned) {
    state.chunkSize = Math.max(1, Math.floor(size / 2))
    return
  }
  const accepted = acceptPlanned(planned, words)
  if (accepted.introduced === 0) return stalled(state, words)
  const { db, userId, deckId, ctx } = req
  const res = persistBatch({ db, userId, deckId, ctx, planned: accepted.cards, state })
  accumulate(state, res, accepted.introduced, total, req.opts)
}

function stalled(state: FillState, words: string[]): void {
  if (words.length > 1) {
    state.chunkSize = Math.max(1, Math.floor(words.length / 2))
    return
  }
  console.warn(`[deck] the generator returned no card for "${words[0]}" — skipped`)
  state.built += 1
}

export function acceptPlanned(
  planned: PlannedCard[],
  requested: string[],
): { cards: PlannedCard[]; introduced: number } {
  const canonical = new Map(requested.map((w) => [wordKey(w), w]))
  const wordOf = (c: PlannedCard) => canonical.get(wordKey(c.back))
  const returned = new Set(planned.filter((c) => c.template === 'vocab').map(wordOf))
  let introduced = 0
  while (introduced < requested.length && returned.has(requested[introduced])) introduced++
  const open = new Set(requested.slice(0, introduced))
  const cards: PlannedCard[] = []
  for (const c of planned) {
    const word = c.template === 'vocab' ? wordOf(c) : undefined
    if (c.template !== 'vocab') cards.push(c)
    else if (word !== undefined && open.delete(word)) cards.push({ ...c, back: word })
  }
  return { cards, introduced }
}

async function planChunk(
  planner: Planner,
  ctx: DeckContext,
  words: string[],
  state: FillState,
  size: number,
): Promise<PlannedCard[] | undefined> {
  try {
    return await planner(planArgs(ctx, words, state, size))
  } catch (err) {
    if (size > 1) return undefined
    throw err
  }
}

function planArgs(ctx: DeckContext, words: string[], state: FillState, size: number) {
  return {
    instruction: ctx.instruction,
    targetLang: ctx.targetLang,
    sourceLang: ctx.sourceLang,
    topic: ctx.topic,
    words,
    knownWords: state.known.slice(),
    variant: ctx.variant,
    readingScript: ctx.readingScript,
    count: size,
    pitchAccent: ctx.pitchAccent,
    hints: ctx.hints,
  }
}

interface PersistReq {
  db: Db
  userId: UserId
  deckId: DeckId
  ctx: DeckContext
  planned: PlannedCard[]
  state: FillState
}

function persistBatch(req: PersistReq) {
  const { ctx, planned, state } = req
  applyDictionaryPitch(ctx.targetLang, ctx.pitchAccent, planned)
  applyDictionaryReading(ctx.targetLang, ctx.readingScript, ctx.hints, planned)
  return persistCards(
    req.db,
    req.userId,
    req.deckId,
    {
      targetLang: ctx.targetLang,
      sourceLang: ctx.sourceLang,
      readingScript: ctx.readingScript,
      startStep: state.step,
      futureWords: state.future,
      knownWords: state.known,
    },
    planned,
  )
}

function accumulate(
  state: FillState,
  res: ReturnType<typeof persistCards>,
  introduced: number,
  total: number,
  opts: FillDeckOptions,
): void {
  state.step += res.newWords.length
  state.known.push(...res.newWords)
  state.newWords.push(...res.newWords)
  state.cardCount += res.cardCount
  state.built += introduced
  opts.onProgress?.(state.built, total)
  if (state.chunkSize < PLAN_CHUNK) state.chunkSize = Math.min(PLAN_CHUNK, state.chunkSize + 1)
}

export async function buildDeck(
  db: Db,
  userId: UserId,
  opts: BuildDeckOptions,
): Promise<BuiltDeck> {
  const created = await createDeckForBuild(db, userId, opts)
  const { newWords, cardCount, built } = await fillDeck(db, userId, created.deckId, {
    ctx: contextFrom(opts),
    opts: { words: created.candidates, count: created.count, knownWords: [], startStep: 0 },
    planner: opts.planner,
  })
  updateDeckSettings(db, created.deckId, { cursor: built })
  return {
    deckId: created.deckId,
    name: created.name,
    cardCount,
    source: created.sourceLabel,
    newWords,
  }
}
