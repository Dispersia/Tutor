/**
 * Pitch-accent backfill (docs/DESIGN.md §11.1). A deck asks the generator for
 * pitch contours when it is built, but cards made before that — an Anki import,
 * an earlier batch — carry none. This asks the generator for the contour of the
 * cards that lack one, so an existing deck can be annotated without rebuilding.
 */

import { parsePitchContour, pitchOf, type Card, type PitchContour } from '@tutor/core'
import type { Db } from '../db/client'
import { listCards, updateCard } from '../db/repo'
import type { OpenRouter, ReasoningEffort } from '../llm/openrouter'
import { kanjiumContour } from './kanjium'

/** One word to annotate: the target-language text and its native reading. */
export interface PitchWord {
  /** The card's `back` (the target-language word). */
  word: string
  /** Its reading (kana for Japanese, Zhuyin for Chinese) — helps the mora split. */
  reading: string
}

/** Resolves a pitch contour per word (keyed by `word`). Missing = unsure. */
export type PitchFetcher = (words: PitchWord[]) => Promise<Map<string, PitchContour>>

/**
 * A contour from the bundled Japanese dictionary (`kanjium.ts`) — offline, no
 * key, and authoritative where it has an entry. Other languages resolve nothing
 * here (their tone contours still come from the generator).
 */
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

/** Runs fetchers in order; the first to resolve a word wins, later ones fill gaps. */
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

/** The cards a backfill should annotate: those with a reading, and (unless
 * `force`) only the ones that still lack a contour. */
export function pitchTargets(cards: Card[], opts: { force?: boolean } = {}): Card[] {
  return cards.filter(
    (card) =>
      (card.readings.kana || card.readings.zhuyin) &&
      (opts.force === true || !pitchOf(card.metadata)),
  )
}

export interface PitchBackfillResult {
  /** Cards that received a contour. */
  updated: number
  /** Every card in the deck, so the caller can show progress. */
  total: number
}

/**
 * Annotate a deck's cards that lack a pitch contour, keeping existing ones.
 * With `force`, re-annotates every card that has a reading (used to replace
 * wrong contours with dictionary-correct ones). Shared by the HTTP route and
 * the one-off backfill script.
 */
export async function backfillDeckPitch(
  db: Db,
  userId: string,
  deckId: string,
  fetcher: PitchFetcher,
  opts: { force?: boolean } = {},
): Promise<PitchBackfillResult> {
  const cards = listCards(db, userId, deckId)
  const targets = pitchTargets(cards, opts)
  if (targets.length === 0) return { updated: 0, total: cards.length }
  const contours = await fetcher(
    targets.map((card) => ({
      word: card.back,
      reading: card.readings.kana ?? card.readings.zhuyin ?? '',
    })),
  )
  let updated = 0
  for (const card of targets) {
    const contour = contours.get(card.back)
    if (!contour) continue
    updateCard(db, card.id, userId, { metadata: { ...card.metadata, pitch: contour } })
    updated++
  }
  return { updated, total: cards.length }
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

/** The user message: the batch of words, with their readings as hints. */
export function pitchPrompt(words: PitchWord[]): string {
  const list = words
    .map((w) => (w.reading ? `- ${w.word} [${w.reading}]` : `- ${w.word}`))
    .join('\n')
  return `Annotate these words:\n${list}`
}

/** An OpenRouter-backed pitch annotator for a deck's language. */
export function llmPitchFetcher(
  or: OpenRouter,
  model: string,
  reasoning: ReasoningEffort,
  targetLang: string,
): PitchFetcher {
  return async (words) => {
    const out = new Map<string, PitchContour>()
    if (words.length === 0) return out
    const { json } = await or.chatJSON<{
      entries?: { word?: unknown; levels?: unknown; syllables?: unknown; drop?: unknown }[]
    }>({
      model,
      schema: PITCH_SCHEMA,
      schemaName: 'pitch',
      reasoning,
      messages: [
        { role: 'system', content: systemFor(targetLang) },
        { role: 'user', content: pitchPrompt(words) },
      ],
    })
    for (const entry of json.entries ?? []) {
      if (typeof entry?.word !== 'string') continue
      const contour = parsePitchContour(entry)
      if (contour) out.set(entry.word, contour)
    }
    return out
  }
}
