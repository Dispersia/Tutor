import type { UserId, DeckId } from '../ids'
import { parsePitchContour, pitchOf, type Card, type PitchContour } from '@tutor/core'
import type { Db } from '../db/client'
import { listCards, updateCard, type ServerCard } from '../db/repo'
import type { OpenRouter, ReasoningEffort } from '../llm/openrouter'
import { kanjiumContour } from './kanjium'

export interface PitchWord {
  word: string
  reading: string
}

export type PitchFetcher = (words: PitchWord[]) => Promise<Map<string, PitchContour>>

export function dictionaryFetcher(targetLang: string): PitchFetcher {
  return async (words) => {
    const out = new Map<string, PitchContour>()
    if (targetLang !== 'ja') return out
    for (const w of words) {
      const contour = kanjiumContour(w.word, w.reading)
      if (contour) out.set(w.word, contour)
    }
    return out
  }
}

export function composeFetchers(...fetchers: PitchFetcher[]): PitchFetcher {
  return async (words) => {
    const out = new Map<string, PitchContour>()
    let pending = words
    for (const fetch of fetchers) {
      if (pending.length === 0) break
      const got = await fetch(pending)
      for (const [word, contour] of got) if (!out.has(word)) out.set(word, contour)
      pending = pending.filter((w) => !out.has(w.word))
    }
    return out
  }
}

function isWordCard(card: Card): boolean {
  const template = card.payload?.template
  return template === undefined ? card.type === 'vocab' : template === 'vocab'
}

export function pitchTargets<C extends Card>(cards: C[], opts: { force?: boolean } = {}): C[] {
  return cards.filter(
    (card) =>
      isWordCard(card) &&
      (card.readings.kana || card.readings.zhuyin) &&
      (opts.force === true || !pitchOf(card.metadata)),
  )
}

export const PITCH_BATCH = 40

export interface PitchBackfillResult {
  updated: number
  total: number
  failedBatches?: number
}

export async function backfillDeckPitch(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  fetcher: PitchFetcher,
  opts: { force?: boolean } = {},
): Promise<PitchBackfillResult> {
  const cards = listCards(db, userId, deckId)
  const targets = pitchTargets(cards, opts)
  if (targets.length === 0) return { updated: 0, total: cards.length }
  const known = await dictionaryFetcher(targets[0]!.targetLang)(targets.map(pitchRequest))
  const fromDictionary = applyContours(db, userId, targets, known)
  const rest = targets.filter((card) => !known.has(card.back))
  const run = await annotateBatches({ db, userId, fetcher }, rest)
  const updated = fromDictionary + run.updated
  if (updated === 0 && run.error) throw run.error
  return { updated, total: cards.length, failedBatches: run.failed || undefined }
}

interface BatchRun {
  updated: number
  failed: number
  error?: Error
}

async function annotateBatches(
  io: { db: Db; userId: UserId; fetcher: PitchFetcher },
  cards: ServerCard[],
): Promise<BatchRun> {
  const run: BatchRun = { updated: 0, failed: 0 }
  for (let i = 0; i < cards.length; i += PITCH_BATCH) {
    const batch = cards.slice(i, i + PITCH_BATCH)
    try {
      const contours = await io.fetcher(batch.map(pitchRequest))
      run.updated += applyContours(io.db, io.userId, batch, contours)
    } catch (err) {
      run.failed++
      run.error = err as Error
      console.warn(`[pitch] a batch of ${batch.length} words failed: ${run.error.message}`)
    }
  }
  return run
}

function pitchRequest(card: ReturnType<typeof listCards>[number]) {
  return { word: card.back, reading: card.readings.kana ?? card.readings.zhuyin ?? '' }
}

function applyContours(
  db: Db,
  userId: UserId,
  targets: ReturnType<typeof listCards>,
  contours: Map<string, PitchContour>,
): number {
  let updated = 0
  for (const card of targets) {
    const contour = contours.get(card.back)
    if (!contour) continue
    updateCard(db, card.id, { metadata: { ...card.metadata, pitch: contour } })
    updated++
  }
  return updated
}

const PITCH_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          syllables: { type: 'array', items: { type: 'string' } },
          levels: { type: 'array', items: { type: 'string', enum: ['H', 'L'] } },
          drop: { type: 'integer' },
        },
        required: ['word', 'levels'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
} as const

const JAPANESE_SYSTEM = `You annotate Japanese words with their standard (Tokyo) pitch accent.

For every word, return:
- "word": the word exactly as given
- "syllables": the word split into moras, in kana
- "levels": one "H" or "L" per mora, in order
- "drop": the accent nucleus counted from 1 — the mora after which the pitch falls. 0 means heiban (no in-word drop).

Return one entry per word you are confident about; omit any word whose standard accent you do not know.`

const TONE_SYSTEM = `You annotate words with the shape of their tone or pitch contour.

For every word, return:
- "word": the word exactly as given
- "syllables": the word split into syllables or moras
- "levels": one "H" or "L" per syllable, in order
- "drop": the position after which the pitch falls (0 when it never drops).

Return one entry per word you are confident about; omit any word you are unsure of.`

function systemFor(targetLang: string): string {
  return targetLang === 'ja' ? JAPANESE_SYSTEM : TONE_SYSTEM
}

export function pitchPrompt(words: PitchWord[]): string {
  const list = words
    .map((w) => (w.reading ? `- ${w.word} [${w.reading}]` : `- ${w.word}`))
    .join('\n')
  return `Annotate these words:\n${list}`
}

export function llmPitchFetcher(
  or: OpenRouter,
  model: string,
  reasoning: ReasoningEffort,
  targetLang: string,
): PitchFetcher {
  return async (words) => {
    if (words.length === 0) return new Map()
    const json = await requestContours(or, { model, reasoning, targetLang }, words)
    return contoursFrom(json.entries ?? [])
  }
}

interface PitchEntry {
  word?: unknown
  levels?: unknown
  syllables?: unknown
  drop?: unknown
}

interface PitchReq {
  model: string
  reasoning: ReasoningEffort
  targetLang: string
}

async function requestContours(or: OpenRouter, req: PitchReq, words: PitchWord[]) {
  const { json } = await or.chatJSON<{ entries?: PitchEntry[] }>({
    model: req.model,
    schema: PITCH_SCHEMA,
    schemaName: 'pitch',
    reasoning: req.reasoning,
    messages: [
      { role: 'system', content: systemFor(req.targetLang) },
      { role: 'user', content: pitchPrompt(words) },
    ],
  })
  return json
}

function contoursFrom(entries: PitchEntry[]): Map<string, PitchContour> {
  const out = new Map<string, PitchContour>()
  for (const entry of entries) {
    if (typeof entry?.word !== 'string') continue
    const contour = parsePitchContour(entry)
    if (contour) out.set(entry.word, contour)
  }
  return out
}
