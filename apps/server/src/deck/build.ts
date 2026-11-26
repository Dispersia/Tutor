import type { UserId, DeckId } from '../ids'
import { listCards, updateCard, updateDeckSettings } from '../db/repo'
import type { Db } from '../db/client'
import { verifyCard } from '../exercises/verify'
import type { PlannedCard, Planner } from './plan'
import { reviewBatch, type ReviewBatch, type Reviewer } from './review'
import {
  applyDictionaryPitch,
  applyDictionaryReading,
  contextFrom,
  persistCards,
  persistOne,
  storedKeys,
  type BuildDeckOptions,
  type BuiltDeck,
  type DeckContext,
  type PersistOpts,
} from './context'
import { asCard, exampleField, verifiedSentenceTwice, verifyContext } from './exampleCards'
import { PLAN_CHUNK, clamp } from './instruction'
import { createDeckForBuild, type CreateDeckResult } from './create'
import { lexiconHints } from './lexicon'
import { acceptPlanned } from './intro'
import { trackDeckJob } from './builds'

type PersistResult = ReturnType<typeof persistCards>

export interface FillDeckOptions {
  words: string[]
  count: number
  knownWords?: string[]
  startStep?: number
  onProgress?: (built: number, total: number) => void
  reviewer?: Reviewer
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
  written: Set<string>
}

function fillState(opts: FillDeckOptions, written: Set<string>): FillState {
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
    written,
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
  const state = fillState(opts, storedKeys(db, userId, deckId))
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
  const reviewed = await reviewBatch(batchReview(req, words, planned))
  const accepted = acceptPlanned(reviewed, words)
  if (accepted.introduced === 0) return stalled(req, words)
  const kept = await keepDrills(accepted.cards, req)
  const { db, userId, deckId, ctx } = req
  const res = persistBatch({ db, userId, deckId, ctx, planned: kept, state })
  persistDropped(req, res.dropped)
  await retryMissing(req, res)
  await attachGrammarExamples(req, res)
  accumulate(state, res, accepted.introduced, total, req.opts)
}

function persistDropped(req: BatchReq, dropped: PersistResult['dropped']): void {
  for (const drop of dropped) {
    const card = fallbackVocab(req, drop.word)
    const opts = persistOpts(req, new Set(req.state.known))
    persistOne({
      db: req.db,
      userId: req.userId,
      deckId: req.deckId,
      opts,
      card,
      step: drop.step,
    })
  }
}

async function retryMissing(req: BatchReq, res: PersistResult): Promise<void> {
  for (let i = 0; i < res.newWords.length; i++) {
    const word = res.newWords[i]!
    if (res.sentenced.has(word)) continue
    const known = new Set([...req.state.known, ...res.newWords.slice(0, i), word])
    const card = await exampleSentence(req, word, known)
    if (card) persistRetry(req, card, known, i)
  }
}

async function attachGrammarExamples(req: BatchReq, res: PersistResult): Promise<void> {
  const cards = listCards(req.db, req.userId, req.deckId).filter(
    (c) =>
      c.payload?.template === 'grammar' && !c.payload?.example && res.newWords.includes(c.back),
  )
  for (const card of cards) {
    const known = new Set([...req.state.known, ...res.newWords, card.back])
    const sentence = await exampleSentence(req, card.back, known)
    if (sentence)
      updateCard(req.db, card.id, { payload: { ...card.payload, example: exampleField(sentence) } })
  }
}

function persistRetry(req: BatchReq, card: PlannedCard, known: Set<string>, index: number): void {
  const { db, userId, deckId, ctx } = req
  applyDictionaryReading(ctx.targetLang, ctx.readingScript, ctx.hints, [card])
  const opts = persistOpts(req, known)
  persistOne({ db, userId, deckId, opts, card, step: req.state.step + index + 1 })
}

function persistOpts(req: BatchReq, known: Set<string>): PersistOpts {
  return {
    targetLang: req.ctx.targetLang,
    sourceLang: req.ctx.sourceLang,
    readingScript: req.ctx.readingScript,
    startStep: req.state.step,
    futureWords: req.state.future,
    knownWords: [...known],
    written: req.state.written,
  }
}

async function exampleSentence(
  req: BatchReq,
  word: string,
  known: Set<string>,
): Promise<PlannedCard | undefined> {
  return verifiedSentenceTwice({
    planner: req.planner,
    request: {
      ...planArgs(req.ctx, [word], req.state, 1),
      knownWords: [...known],
      reinforce: true,
    },
    targetLang: req.ctx.targetLang,
    future: req.state.future,
    known,
    deck: req.ctx,
  })
}

async function keepDrills(cards: PlannedCard[], req: BatchReq): Promise<PlannedCard[]> {
  const known = new Set(req.state.known)
  const out: PlannedCard[] = []
  for (const card of cards) {
    if (card.template !== 'vocab' && !(await drillOk(card, req, known))) continue
    if (card.template === 'vocab' || card.payload?.intro === true) known.add(card.back)
    out.push(card)
  }
  return out
}

async function drillOk(card: PlannedCard, req: BatchReq, known: Set<string>): Promise<boolean> {
  const verdict = await verifyCard(verifyContext(asCard(card, req.ctx), req.ctx, known))
  if (!verdict.ok) {
    const why = verdict.failures.join('; ')
    console.warn(`[deck] dropped ${card.template} "${card.back}" — ${why}`)
  }
  return verdict.ok
}

function stalled(req: BatchReq, words: string[]): void {
  const { state } = req
  if (words.length > 1) {
    state.chunkSize = Math.max(1, Math.floor(words.length / 2))
    return
  }
  const word = words[0]!
  console.warn(`[deck] the generator returned no card for "${word}" — using a vocab card`)
  persistFallback(req, word)
  state.built += 1
}

function persistFallback(req: BatchReq, word: string): void {
  const { state } = req
  const card = fallbackVocab(req, word)
  const opts = persistOpts(req, new Set(state.known))
  persistOne({
    db: req.db,
    userId: req.userId,
    deckId: req.deckId,
    opts,
    card,
    step: state.step + 1,
  })
  state.newWords.push(word)
  state.known.push(word)
  state.future.delete(word)
  state.step += 1
  state.cardCount += 1
}

function fallbackVocab(req: BatchReq, word: string): PlannedCard {
  const meaning = planHints(req.ctx, [word])[word]?.meaning
  return { template: 'vocab', front: meaning ?? word, back: word }
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

function batchReview(req: BatchReq, words: string[], planned: PlannedCard[]): ReviewBatch {
  return {
    instruction: req.ctx.instruction,
    targetLang: req.ctx.targetLang,
    sourceLang: req.ctx.sourceLang,
    words,
    knownWords: req.state.known,
    cards: planned,
    reviewer: req.opts.reviewer,
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
    hints: planHints(ctx, words),
  }
}

function planHints(
  ctx: DeckContext,
  words: string[],
): Record<string, { reading?: string; meaning?: string }> {
  return { ...lexiconHints(ctx.targetLang, words), ...(ctx.hints ?? {}) }
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
  const run = fillDeck(db, userId, created.deckId, firstFill(created, opts))
  trackDeckJob(created.deckId, run)
  const { newWords, cardCount, built } = await run
  updateDeckSettings(db, created.deckId, { cursor: built })
  return builtDeck(created, cardCount, newWords)
}

function firstFill(created: CreateDeckResult, opts: BuildDeckOptions): FillDeckRequest {
  return {
    ctx: contextFrom(opts),
    opts: {
      words: created.candidates,
      count: created.count,
      knownWords: [],
      startStep: 0,
      reviewer: opts.reviewer,
    },
    planner: opts.planner,
  }
}

function builtDeck(created: CreateDeckResult, cardCount: number, newWords: string[]): BuiltDeck {
  return {
    deckId: created.deckId,
    name: created.name,
    cardCount,
    source: created.sourceLabel,
    newWords,
  }
}
