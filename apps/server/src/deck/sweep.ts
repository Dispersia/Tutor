/**
 * Audit + rewrite of a deck's example cards (sentence + grammar), driven by the
 * `scripts/sweep-cards.ts` CLI.
 *
 * Generated decks drift: the model is asked for strict n+1 and often satisfies
 * the shape with a sentence nobody would say ("我的你。") or leaks its reasoning
 * into a gloss. For each example card this either strips the meta-commentary the
 * deterministic pass can catch and asks the generator to rewrite it into a
 * natural, n+1 card, or drops it when no natural sentence is possible.
 *
 * Vocabulary cards and their ids are never touched, so SRS scheduling, review
 * history and lesson progress survive.
 */

import type { Card } from '@tutor/core'
import type { Db } from '../db/client'
import { listCards } from '../db/repo'
import type { ChatMessage, OpenRouter } from '../llm/openrouter'
import { langName, scriptRule } from '../llm/prompts'
import { roleReasoning } from '../env'
import { leapsAhead } from './context'
import { stripMetaCommentary, type PlannedCard } from './plan'
import type { CharacterVariant } from '../frequency/source'

/** How many example cards one model call audits. */
const BATCH = 8

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          drop: { type: 'boolean' },
          front: { type: 'string' },
          back: { type: 'string' },
          reading: { type: 'string' },
          payload: { type: 'object', additionalProperties: true },
          reason: { type: 'string' },
        },
        required: ['index'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

interface AuditCard {
  index: number
  drop?: boolean
  front?: string
  back?: string
  reading?: string
  payload?: Record<string, unknown>
  reason?: string
}

/** The deck being swept, read straight from the `decks` table. */
export interface DeckRow {
  id: string
  userId: string
  name: string
  sourceLang: string
  targetLang: string
  instruction: string
  variant?: CharacterVariant
  readingScript?: string
}

/** Minimal `sqlite.run` surface the sweep needs (sql + array bindings). */
export type SweepRun = (sql: string, params?: string[]) => unknown

export interface SweepOptions {
  db: Db
  run: SweepRun
  or: OpenRouter
  model: string
  deck: DeckRow
  dry: boolean
  concurrency: number
  /** Audit at most this many example cards (0 = all). */
  limit: number
}

export interface DeckSweep {
  fixed: number
  dropped: number
  kept: number
}

/** Everything one deck's audit needs, once its cards are loaded. */
interface SweepCtx extends SweepOptions {
  examples: Card[]
  vocabByStep: Map<number, string>
  vocabSorted: string[]
}

/** A card the model proposed to change, ready to write. */
interface Rewrite {
  front: string
  back: string
  readings: Record<string, string>
  payload: Record<string, unknown>
}

/** Audits and rewrites one deck's example cards; returns the run's tally. */
export async function sweepDeck(opts: SweepOptions): Promise<DeckSweep> {
  const ctx = deckContext(opts)
  if (!ctx) return { fixed: 0, dropped: 0, kept: 0 }
  const queue = chunk(ctx.examples, BATCH)
  const tally = await runPool(ctx, queue)
  const dry = opts.dry ? ' (dry run)' : ''
  console.log(`  → ${tally.fixed} fixed, ${tally.dropped} dropped, ${tally.kept} kept${dry}`)
  return tally
}

/** The audit context for one deck, or undefined when it has no example cards. */
function deckContext(opts: SweepOptions): SweepCtx | undefined {
  const cards = listCards(opts.db, opts.deck.userId, opts.deck.id)
  const vocabByStep = vocabSteps(cards)
  const examples = exampleCards(cards, opts.limit)
  if (!examples.length) {
    console.log(`· ${opts.deck.name}: no example cards`)
    return undefined
  }
  console.log(`\n=== ${opts.deck.name} (${opts.deck.targetLang}) — ${examples.length} examples ===`)
  return { ...opts, examples, vocabByStep, vocabSorted: sortedVocab(vocabByStep) }
}

/** The new word each step introduces (a card's `payload.step`). */
function vocabSteps(cards: Card[]): Map<number, string> {
  const byStep = new Map<number, string>()
  for (const c of cards) {
    if (c.payload?.template !== 'vocab' && c.type !== 'vocab') continue
    const s = c.payload?.step
    if (typeof s === 'number') byStep.set(s, c.back)
  }
  return byStep
}

const sortedVocab = (byStep: Map<number, string>): string[] =>
  [...byStep.values()].sort((a, b) => b.length - a.length)

/** The deck's example cards, by step, capped by `limit`. */
function exampleCards(cards: Card[], limit: number): Card[] {
  const examples = cards
    .filter((c) => c.type === 'phrase' || c.type === 'grammar')
    .sort((a, b) => stepOf(a) - stepOf(b))
  return limit ? examples.slice(0, limit) : examples
}

/** Runs the batches with a fixed worker pool, returning the tally. */
async function runPool(ctx: SweepCtx, queue: Card[][]): Promise<DeckSweep> {
  const tally: DeckSweep = { fixed: 0, dropped: 0, kept: 0 }
  const size = Math.min(ctx.concurrency, queue.length)
  const workers = Array.from({ length: size }, () => drain(ctx, queue, tally))
  await Promise.all(workers)
  return tally
}

/** One worker: pull batches off the queue until it is empty. */
async function drain(ctx: SweepCtx, queue: Card[][], tally: DeckSweep): Promise<void> {
  for (;;) {
    const batch = queue.shift()
    if (!batch) return
    await runBatch(ctx, batch, tally)
  }
}

/** Audits one batch and applies each verdict. */
async function runBatch(ctx: SweepCtx, batch: Card[], tally: DeckSweep): Promise<void> {
  const verdicts = await auditBatch(ctx, batch)
  if (!verdicts) return
  for (let i = 0; i < batch.length; i++) applyOne(ctx, batch[i]!, verdicts.get(i), tally)
}

/** Asks the model to audit one batch; undefined when the call failed. */
async function auditBatch(
  ctx: SweepCtx,
  batch: Card[],
): Promise<Map<number, AuditCard> | undefined> {
  try {
    const { json } = await ctx.or.chatJSON<{ cards?: AuditCard[] }>({
      model: ctx.model,
      schema: SWEEP_SCHEMA,
      schemaName: 'sweep',
      reasoning: roleReasoning.generator,
      messages: batchMessages(ctx, batch),
    })
    return indexVerdicts(json.cards)
  } catch (err) {
    const minStep = Math.min(...batch.map(stepOf))
    console.warn(`  batch at step ${minStep} failed: ${(err as Error).message}`)
    return undefined
  }
}

function indexVerdicts(cards: AuditCard[] | undefined): Map<number, AuditCard> {
  const byIndex = new Map<number, AuditCard>()
  for (const a of cards ?? []) byIndex.set(a.index, a)
  return byIndex
}

/** The system + user messages for one audit batch. */
function batchMessages(ctx: SweepCtx, batch: Card[]): ChatMessage[] {
  const system = systemFor(
    langName(ctx.deck.targetLang),
    langName(ctx.deck.sourceLang),
    scriptRule(ctx.deck.targetLang, ctx.deck),
  )
  return [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt(ctx, batch) },
  ]
}

function userPrompt(ctx: SweepCtx, batch: Card[]): string {
  const items = batch.map((c, index) => auditItem(ctx, c, index))
  return `The instruction this deck was built from: ${ctx.deck.instruction}

Cards to proofread:
${JSON.stringify(items)}`
}

/** One card as the model sees it: its content plus the words known at its step. */
function auditItem(ctx: SweepCtx, c: Card, index: number) {
  return {
    index,
    step: stepOf(c),
    type: c.type,
    front: c.front,
    back: c.back,
    reading: Object.values(c.readings)[0] ?? '',
    payload: c.payload ?? {},
    known: knownAtStep(ctx.vocabByStep, stepOf(c)).slice(-120),
  }
}

/** The words the learner has met at a card's step (its lesson and before). */
function knownAtStep(vocabByStep: Map<number, string>, step: number): string[] {
  const words: string[] = []
  for (const [s, w] of vocabByStep) if (s <= step) words.push(w)
  return words
}

/** Decides one card's fate: keep it, drop it, or apply a validated rewrite. */
function applyOne(
  ctx: SweepCtx,
  card: Card,
  verdict: AuditCard | undefined,
  tally: DeckSweep,
): void {
  if (verdict?.drop) return dropCard(ctx, card, verdict.reason, tally)
  const next = verdict ? applyVerdict(card, verdict) : undefined
  if (!next) return keepOne(tally)
  const reject = rejection(ctx, card, next)
  if (reject) keepBecause(card, reject, tally)
  else writeRewrite(ctx, card, next, tally)
}

/** Keeps a card the model left alone (no verdict, or a no-op one). */
function keepOne(tally: DeckSweep): void {
  tally.kept++
}

function dropCard(ctx: SweepCtx, card: Card, reason: string | undefined, tally: DeckSweep): void {
  tally.dropped++
  console.log(`  drop: ${describe(card)}  — ${short(reason)}`)
  if (!ctx.dry) removeCard(ctx.run, card.id)
}

function keepBecause(card: Card, reason: string, tally: DeckSweep): void {
  tally.kept++
  console.log(`  keep: ${describe(card)}  — ${reason}`)
}

function writeRewrite(ctx: SweepCtx, card: Card, next: Rewrite, tally: DeckSweep): void {
  tally.fixed++
  const prompt = typeof next.payload.prompt === 'string' ? `  |  ${next.payload.prompt}` : ''
  console.log(`  fix:  ${describe(card)}\n     →  ${next.back}  |  ${next.front}${prompt}`)
  if (!ctx.dry) updateCard(ctx.run, card.id, next)
}

/** The reason a rewrite cannot ship, or undefined when it is fine. */
function rejection(ctx: SweepCtx, card: Card, next: Rewrite): string | undefined {
  const invalid =
    grammarRejection(card, next) ??
    sentenceRejection(card, next) ??
    nPlusOneRejection(ctx, card, next)
  return invalid
}

/** A grammar fix must still carry an answer and a target-language prompt. */
function grammarRejection(card: Card, next: Rewrite): string | undefined {
  if (card.type !== 'grammar') return undefined
  const answer = next.payload.answer ?? next.back
  const prompt = next.payload.prompt ?? next.front
  if (!answer || typeof prompt !== 'string' || !prompt) return 'rewrite had no answer/prompt'
  if (prompt.includes('___') && !looksTarget(prompt, card.targetLang)) {
    return 'cloze prompt is not in the target language'
  }
  return undefined
}

/** A sentence fix must keep its tokens and back in agreement. */
function sentenceRejection(card: Card, next: Rewrite): string | undefined {
  if (card.type !== 'phrase') return undefined
  const tokens = next.payload.tokens
  if (!Array.isArray(tokens) || tokens.length < 2) return undefined
  return tokensMatchBack(tokens, next.back) ? undefined : 'rewrite tokens no longer match its back'
}

/** A rewrite must not reach a word introduced after this card's step. */
function nPlusOneRejection(ctx: SweepCtx, card: Card, next: Rewrite): string | undefined {
  const future = futureWords(ctx.vocabByStep, stepOf(card))
  const planned = plannedCard(card, next)
  const promptText = typeof next.payload.prompt === 'string' ? next.payload.prompt : ''
  const promptTokens = promptText ? tokenize(promptText.replace(/___/g, ''), ctx.vocabSorted) : []
  if (!leapsAhead(planned, future) && !promptTokens.some((t) => future.has(t))) return undefined
  return 'only fixable with a word not yet met (n+1)'
}

function futureWords(byStep: Map<number, string>, step: number): Set<string> {
  return new Set([...byStep.entries()].filter(([s]) => s > step).map(([, w]) => w))
}

/** A rewrite as the planner sees it, so `leapsAhead` can vet it. */
function plannedCard(card: Card, next: Rewrite): PlannedCard {
  return {
    template: card.type === 'grammar' ? 'grammar' : 'sentence',
    front: next.front,
    back: next.back,
    payload: next.payload,
  }
}

/** Merges a verdict into the card, or undefined when nothing changed. */
function applyVerdict(card: Card, verdict: AuditCard): Rewrite | undefined {
  const sides = targetSides(card, verdict)
  if (!sides) return undefined
  if (!changedBy(card, verdict, sides)) return undefined
  return {
    front: sides.front,
    back: sides.back,
    readings: mergedReadings(card, verdict.reading),
    payload: mergedPayload(card, verdict.payload),
  }
}

/** The front/back with commentary stripped and the target language on `back`. */
function targetSides(card: Card, verdict: AuditCard): { front: string; back: string } | undefined {
  const front = stripMetaCommentary(verdict.front ?? card.front)
  const back = stripMetaCommentary(verdict.back ?? card.back)
  if (!front || !back) return undefined
  // The model sometimes swaps the sides; put the target language back in `back`.
  if (looksTarget(front, card.targetLang) && !looksTarget(back, card.targetLang)) {
    return { front: back, back: front }
  }
  return { front, back }
}

function changedBy(
  card: Card,
  verdict: AuditCard,
  sides: { front: string; back: string },
): boolean {
  const sameSides = sides.front === card.front && sides.back === card.back
  return !sameSides || verdict.payload !== undefined || verdict.reading !== undefined
}

function mergedReadings(card: Card, reading: string | undefined): Record<string, string> {
  const readings = { ...card.readings }
  if (reading === undefined) return readings
  const key = card.targetLang === 'ja' ? 'kana' : card.targetLang === 'zh' ? 'zhuyin' : 'reading'
  if (reading) readings[key] = reading
  else delete readings[key]
  return readings
}

function mergedPayload(
  card: Card,
  update: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const payload = { ...(card.payload ?? {}), ...(update ?? {}) }
  if (typeof payload.prompt === 'string')
    payload.prompt = payload.prompt.replace(/\s*___\s*/g, '___')
  return payload
}

/** Han / kana / half-width katakana — the scripts a zh/ja target uses. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/
const looksTarget = (text: string, lang: string): boolean =>
  (lang === 'zh' || lang === 'yue' || lang === 'ja') && CJK.test(text)

/** A sentence's tokens must rebuild its back, ignoring spaces and punctuation. */
function tokensMatchBack(tokens: unknown[], back: string): boolean {
  const bare = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const joined = tokens.filter((t): t is string => typeof t === 'string').join('')
  return bare(joined) === bare(back)
}

/**
 * Greedy longest-match tokeniser over the deck's vocabulary, so a target sentence
 * can be checked word by word without a real segmenter. Words not in the list
 * fall back to single characters.
 */
function tokenize(text: string, sortedWords: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const match = sortedWords.find((w) => w.length > 1 && text.startsWith(w, i))
    if (match) {
      out.push(match)
      i += match.length
    } else {
      out.push(ch)
      i++
    }
  }
  return out
}

function stepOf(c: Card): number {
  const s = c.payload?.step
  return typeof s === 'number' ? s : 1_000_000
}

function describe(c: Card): string {
  return `${c.type} ${JSON.stringify(c.back)} / ${JSON.stringify(c.front)}`
}

/** One short line, so a model's rambling reason does not flood the report. */
function short(text: string | undefined): string {
  const t = (text ?? 'invalid').replace(/\s+/g, ' ').trim()
  return t.length > 140 ? `${t.slice(0, 137)}…` : t
}

function updateCard(run: SweepRun, id: string, next: Rewrite): void {
  run('update cards set front = ?, back = ?, readings_json = ?, payload_json = ? where id = ?', [
    next.front,
    next.back,
    JSON.stringify(next.readings),
    JSON.stringify(next.payload),
    id,
  ])
}

/** Removes a dropped card and every trace of it (schedule, history, attempts). */
function removeCard(run: SweepRun, id: string): void {
  run('delete from srs where card_id = ?', [id])
  run('delete from srs_reviews where card_id = ?', [id])
  run('delete from reviews where card_id = ?', [id])
  run('delete from attempts where card_id = ?', [id])
  run('delete from cards where id = ?', [id])
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function systemFor(lang: string, source: string, rules: string): string {
  return `You proofread the example cards of a beginner ${lang} deck for a ${source} speaker. Return only the JSON the schema asks for, with one entry for every index.

Each card comes with "known": the words the learner has met by that card. A good card is something a native speaker would really say, uses only its known words, and holds no notes or commentary.

For each card choose one:
- Good as it is: return its index alone.
- Fixable: return its index with only the corrected fields.
- Not fixable: return its index with drop=true and a one-line reason. Drop a card only when it is ungrammatical or makes no sense, or when no natural sentence can be made from its known words.

How to fix:
- Keep the card on the word it already practises, and use only its known words.
- Sentence cards: back is the ${lang} sentence, short and concrete. front and payload.gloss are the same single natural ${source} translation of the whole sentence.
- Grammar cards: always return a payload. payload.prompt is a ${lang} sentence with one word replaced by ___ (three underscores, no spaces around them), payload.answer and back are the missing word, payload.rule and front are a few ${source} words naming the point, and payload.explanation is one short ${source} sentence. Keep payload.options when the card has them. Example: prompt "你好___？", answer "嗎".
- A field holds its content and nothing else: no notes, alternatives or brackets.
${rules ? `- ${rules}` : ''}`
}
