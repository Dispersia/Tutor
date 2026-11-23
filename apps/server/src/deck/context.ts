/** The deck-wide context, the option types and the card-persisting helpers. */

import type { UserId, DeckId } from '../ids'
import type { CardType } from '@tutor/core'
import { addCard } from '../db/repo'
import type { Db } from '../db/client'
import type { CharacterVariant, Fetcher } from '../frequency/source'
import type { PlannedCard, Planner } from './plan'
import { kanjiumContour } from './kanjium'
import { mandarinSentenceZhuyin, mandarinZhuyin } from './mandarin'
import { storedReadings } from '../text/readings'

export interface BuildDeckOptions {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
  /** How many new words to introduce (default 20). */
  count?: number
  name?: string
  variant?: CharacterVariant
  readingScript?: string
  showReadings?: boolean
  disabledExercises?: string[]
  /** Ask the generator for pitch-accent metadata (Japanese, …). */
  pitchAccent?: boolean
  /** An explicit ordered word list (imported decks) — skips the frequency pull. */
  words?: string[]
  /** Provenance label shown on the deck (e.g. the imported deck's name). */
  sourceLabel?: string
  /** Per-word reading/meaning hints from the source (imported decks). */
  hints?: Record<string, { reading?: string; meaning?: string }>
  fetcher?: Fetcher
  planner: Planner
}

export interface GrowDeckOptions {
  count?: number
  topic?: string
  fetcher?: Fetcher
  planner: Planner
}

export interface BuiltDeck {
  deckId: DeckId
  name: string
  cardCount: number
  /** The frequency list it was built from, e.g. "zh_tw (Traditional)". */
  source: string
  /** The words this batch introduced. */
  newWords: string[]
}

/**
 * The deck-level rules every batch of a deck shares. Held apart from the word
 * list so a long build can drive many planner calls through the same context.
 */
export interface DeckContext {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
  variant?: CharacterVariant
  readingScript?: string
  pitchAccent?: boolean
  /** Per-word reading/meaning hints (imported decks). */
  hints?: Record<string, { reading?: string; meaning?: string }>
}

/**
 * The stored reading for a planned card, in the deck's script. `back` (the
 * card's own text) lets a Mandarin reading that cannot be converted fall back to
 * the dictionary instead of being stored as garbage.
 */
export function readingsForPlanned(
  targetLang: string,
  reading: string | undefined,
  script: string | undefined,
  back?: string,
): Record<string, string> {
  // The deck wants Zhuyin. A reading that came back as pinyin (the model
  // ignored the script rule, or a sentence the dictionary does not cover) is
  // converted, so the learner never sees Latin letters where Zhuyin belongs.
  const fallbackZhuyin = () => (back ? mandarinSentenceZhuyin(back) : undefined)
  return storedReadings({ targetLang, reading, script, fallbackZhuyin })
}

export { zhuyinFromPinyin } from '../text/readings'

function cardTypeFor(template: PlannedCard['template']): CardType {
  if (template === 'sentence') return 'phrase'
  if (template === 'grammar') return 'grammar'
  return 'vocab'
}

/**
 * When a Japanese deck asks for pitch accent, prefer the bundled dictionary over
 * the model's guess. The generator's contour is kept only where the dictionary
 * has nothing — the generator is unreliable on Tokyo accent (DESIGN §11.1).
 */
export function applyDictionaryPitch(
  targetLang: string,
  pitchAccent: boolean | undefined,
  planned: PlannedCard[],
): void {
  if (targetLang !== 'ja' || !pitchAccent) return
  for (const card of planned) {
    if (card.template !== 'vocab' || !card.reading) continue
    const contour = kanjiumContour(card.back, card.reading)
    if (contour) card.metadata = { ...(card.metadata ?? {}), pitch: contour }
  }
}

/**
 * Chinese readings come from the bundled Taiwan dictionary instead of the
 * generator's guess (Zhuyin only, so a pinyin deck is left alone). A word that
 * arrived with its own reading — an Anki import — keeps that reading, which is
 * the source deck's authority, not something to overwrite.
 */
export function applyDictionaryReading(
  targetLang: string,
  readingScript: string | undefined,
  hints: Record<string, { reading?: string; meaning?: string }> | undefined,
  planned: PlannedCard[],
): void {
  if (targetLang !== 'zh' || readingScript === 'pinyin') return
  for (const card of planned) {
    if (hints?.[card.back]?.reading) continue
    // A dictionary word (or multi-character term) wins. A sentence — which the
    // dictionary has no whole entry for — only gets a composed reading when it
    // arrived with none, so a good generator reading is never downgraded.
    const word = mandarinZhuyin(card.back)
    if (word) card.reading = word
    else if (!card.reading) card.reading = mandarinSentenceZhuyin(card.back)
  }
}

/** The highest n+1 step already present in a deck (0 when empty). */
export function maxStep(cards: { payload: Record<string, unknown> }[]): number {
  let max = 0
  for (const c of cards) {
    const s = c.payload?.step
    if (typeof s === 'number' && s > max) max = s
  }
  return max
}

/**
 * True when a sentence/grammar card reaches ahead to a word the deck has not
 * introduced yet — a strict n+1 violation. The planner is asked to stay inside
 * the known words, but it cannot see the order, so a grammar point built on a
 * word that arrives many steps later ("dono" before its own card) is dropped
 * rather than shipped. Only the text the learner has to produce/read is checked
 * (a sentence's tokens, a grammar card's answer), never the distractor options.
 */
export function leapsAhead(card: PlannedCard, future: ReadonlySet<string>): boolean {
  if (future.size === 0) return false
  const tokens = card.payload?.tokens
  if (Array.isArray(tokens) && tokens.some((t) => typeof t === 'string' && future.has(t))) {
    return true
  }
  const answer = card.payload?.answer
  if (typeof answer === 'string' && future.has(answer)) return true
  // Cards without an explicit answer produce `back` itself.
  return future.has(card.back)
}

/**
 * Persists planned cards, tagging each with its template + n+1 step.
 *
 * `futureWords` is the mutable set of words still waiting to be introduced; a
 * vocab card removes its word as it is persisted. That makes the ordering real:
 * a sentence printed before its word's vocab card has that word still in
 * `future`, so {@link leapsAhead} drops it, while the same sentence after the
 * vocab card is kept.
 */
export function persistCards(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: PersistOpts,
  planned: PlannedCard[],
): { newWords: string[]; cardCount: number } {
  let step = opts.startStep
  const newWords: string[] = []
  let cardCount = 0
  for (const c of planned) {
    step = bookkeep(c, opts, step, newWords)
    if (c.template !== 'vocab' && leapsAhead(c, opts.futureWords)) continue
    persistOne({ db, userId, deckId, opts, card: c, step: Math.max(step, 1) })
    cardCount++
  }
  return { newWords, cardCount }
}

/** For a vocab card: advance the step, record the word, clear it from `future`. */
function bookkeep(c: PlannedCard, opts: PersistOpts, step: number, newWords: string[]): number {
  if (c.template !== 'vocab') return step
  newWords.push(c.back)
  opts.futureWords.delete(c.back)
  return step + 1
}

interface PersistOpts {
  targetLang: string
  sourceLang: string
  readingScript?: string
  startStep: number
  futureWords: Set<string>
}

interface PersistReq {
  db: Db
  userId: UserId
  deckId: DeckId
  opts: PersistOpts
  card: PlannedCard
  step: number
}

function persistOne(req: PersistReq): void {
  const { db, userId, deckId, opts, card: c, step } = req
  addCard(db, userId, {
    deckId,
    type: cardTypeFor(c.template),
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    front: c.front,
    back: c.back,
    readings: readingsForPlanned(opts.targetLang, c.reading, opts.readingScript, c.back),
    tags: [opts.targetLang, c.template],
    payload: { ...(c.payload ?? {}), template: c.template, step },
    metadata: c.metadata,
    origin: 'llm',
  })
}

/** Turns a `BuildDeckOptions` into the deck-wide context the planner needs. */
export function contextFrom(opts: BuildDeckOptions): DeckContext {
  return {
    instruction: opts.instruction,
    targetLang: opts.targetLang,
    sourceLang: opts.sourceLang,
    topic: opts.topic,
    variant: opts.variant,
    readingScript: opts.readingScript,
    pitchAccent: opts.pitchAccent,
    hints: opts.hints,
  }
}
