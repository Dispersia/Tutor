import type { CardType } from '@tutor/core'
import {
  addCard,
  createDeck,
  getDeck,
  listCards,
  rememberedDeckInstruction,
  updateDeckSettings,
} from '../db/repo'
import type { Db } from '../db/client'
import {
  fetchFrequencyWords,
  frequencySourceFor,
  type CharacterVariant,
  type Fetcher,
} from '../frequency/source'
import type { PlannedCard, Planner } from './plan'
import type { DeckSettings } from './settings'
import { kanjiumContour } from './kanjium'
import { mandarinZhuyin } from './mandarin'

/**
 * Builds and grows decks from a user instruction (docs/DESIGN.md §13.7).
 *
 *   instruction ──► pull a frequency list ──► planner (LLM + templates) ──► cards
 *
 * The deck is generated, never pre-seeded, and grows in batches: each batch
 * introduces `count` new words, strictly n+1, following the deck's own reading
 * rules. Both the fetcher and the planner are injected so tests run offline.
 */

export interface BuildDeckOptions {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
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
  deckId: string
  name: string
  cardCount: number
  /** The frequency list it was built from, e.g. "zh_tw (Traditional)". */
  source: string
  /** The words this batch introduced. */
  newWords: string[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/** Reads the character variant / reading script a free-text instruction asks for. */
export function parseInstruction(
  instruction: string,
  targetLang: string,
): { variant?: CharacterVariant; readingScript?: string; pitchAccent?: boolean } {
  const s = instruction.toLowerCase()
  const isChinese = targetLang === 'zh' || targetLang === 'yue'
  const isJapanese = targetLang === 'ja'

  // The deck's language wins over wording borrowed from another deck's prompt:
  // a remembered Chinese prompt must never force Zhuyin on a Japanese deck.
  let variant: CharacterVariant | undefined
  if (isChinese) {
    if (/traditional|繁體|繁体|zh_tw/.test(s)) variant = 'traditional'
    else if (/simplified|简体|簡體|zh_cn/.test(s)) variant = 'simplified'
    else if (targetLang === 'zh') variant = 'traditional' // the app's default
  }

  let readingScript: string | undefined
  if (isChinese) {
    if (/zhuyin|注音|bopomofo|ㄅㄆㄇ/.test(s)) readingScript = 'zhuyin'
    else if (/pinyin|拼音/.test(s)) readingScript = 'pinyin'
    else readingScript = 'zhuyin'
  } else if (isJapanese) {
    readingScript = /romaji|rōmaji/.test(s) ? 'romaji' : 'kana'
  }

  // Pitch-accent metadata is language-specific but opt-in: only ask the
  // generator when the instruction does (Japanese pitch accent, tone contours).
  const pitchAccent = /pitch|accent|アクセント|音調|音调|高低|聲調|声调|tone contour|tones?/.test(s)

  return { variant, readingScript, pitchAccent }
}

/** The stored reading for a planned card, in the deck's script. */
function readingsForPlanned(
  targetLang: string,
  reading: string | undefined,
  script: string | undefined,
): Record<string, string> {
  if (!reading) return {}
  if (targetLang === 'zh' || targetLang === 'yue') {
    return script === 'pinyin' ? { pinyin: reading } : { zhuyin: reading }
  }
  if (targetLang === 'ja') return { kana: reading }
  return { reading }
}

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
function applyDictionaryPitch(
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
function applyDictionaryReading(
  targetLang: string,
  readingScript: string | undefined,
  hints: Record<string, { reading?: string; meaning?: string }> | undefined,
  planned: PlannedCard[],
): void {
  if (targetLang !== 'zh' || readingScript === 'pinyin') return
  for (const card of planned) {
    if (hints?.[card.back]?.reading) continue
    const zhuyin = mandarinZhuyin(card.back)
    if (zhuyin) card.reading = zhuyin
  }
}

/** The highest n+1 step already present in a deck (0 when empty). */
function maxStep(cards: { payload: Record<string, unknown> }[]): number {
  let max = 0
  for (const c of cards) {
    const s = c.payload?.step
    if (typeof s === 'number' && s > max) max = s
  }
  return max
}

/** Persists planned cards, tagging each with its template + n+1 step. */
function persistCards(
  db: Db,
  userId: string,
  deckId: string,
  opts: { targetLang: string; sourceLang: string; readingScript?: string; startStep: number },
  planned: PlannedCard[],
): { newWords: string[]; cardCount: number } {
  let step = opts.startStep
  const newWords: string[] = []
  let cardCount = 0
  for (const c of planned) {
    if (c.template === 'vocab') {
      step++
      newWords.push(c.back)
    }
    addCard(db, userId, {
      deckId,
      type: cardTypeFor(c.template),
      sourceLang: opts.sourceLang,
      targetLang: opts.targetLang,
      front: c.front,
      back: c.back,
      readings: readingsForPlanned(opts.targetLang, c.reading, opts.readingScript),
      tags: [opts.targetLang, c.template],
      payload: { ...(c.payload ?? {}), template: c.template, step: Math.max(step, 1) },
      metadata: c.metadata,
      origin: 'llm',
    })
    cardCount++
  }
  return { newWords, cardCount }
}

/**
 * Builds a new deck from an instruction: pulls a frequency list, generates a
 * first batch of cards (n+1), and stores the deck with its own settings.
 */
export async function buildDeck(
  db: Db,
  userId: string,
  opts: BuildDeckOptions,
): Promise<BuiltDeck> {
  const count = clamp(opts.count ?? 20, 1, 50)

  // The words come either from an imported deck or from a pulled frequency list.
  let candidates: string[]
  let sourceLabel: string
  let wordSource: 'frequency' | 'anki'
  if (opts.words?.length) {
    candidates = opts.words
    sourceLabel = opts.sourceLabel ?? 'uploaded deck'
    wordSource = 'anki'
  } else {
    const source = frequencySourceFor(opts.targetLang, opts.variant)
    if (!source) throw new Error(`no frequency list for language "${opts.targetLang}"`)
    const { words } = await fetchFrequencyWords(opts.targetLang, {
      variant: opts.variant,
      fetcher: opts.fetcher,
      source,
      limit: Math.max(count * 8, 300),
    })
    candidates = words.map((w) => w.word)
    sourceLabel = source.label
    wordSource = 'frequency'
  }

  const planned = await opts.planner({
    instruction: opts.instruction,
    targetLang: opts.targetLang,
    sourceLang: opts.sourceLang,
    topic: opts.topic,
    words: candidates,
    knownWords: [],
    variant: opts.variant,
    readingScript: opts.readingScript,
    count,
    pitchAccent: opts.pitchAccent,
    hints: opts.hints,
  })
  applyDictionaryPitch(opts.targetLang, opts.pitchAccent, planned)
  applyDictionaryReading(opts.targetLang, opts.readingScript, opts.hints, planned)

  const settings: DeckSettings = {
    variant: opts.variant,
    readingScript: opts.readingScript,
    showReadings: opts.showReadings,
    disabledExercises: opts.disabledExercises,
    pitchAccent: opts.pitchAccent,
    cursor: count,
    batchSize: count,
    instruction: opts.instruction,
    wordSource,
    // keep the source list so an imported deck can keep growing without it
    words: wordSource === 'anki' ? candidates.slice(0, 5000) : undefined,
  }
  const name = opts.name?.trim() || `${opts.topic ?? opts.targetLang} · generated`
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Generated from ${sourceLabel}`,
    settings,
  })
  const { newWords, cardCount } = persistCards(
    db,
    userId,
    deck.id,
    {
      targetLang: opts.targetLang,
      sourceLang: opts.sourceLang,
      readingScript: opts.readingScript,
      startStep: 0,
    },
    planned,
  )
  return { deckId: deck.id, name, cardCount, source: sourceLabel, newWords }
}

/**
 * Grows a deck organically: pulls the next slice of its frequency list and adds
 * another n+1 batch. `topic` narrows the batch to a theme (e.g. a restaurant).
 */
export async function growDeck(
  db: Db,
  userId: string,
  deckId: string,
  opts: GrowDeckOptions,
): Promise<BuiltDeck> {
  const deck = getDeck(db, deckId, userId)
  if (!deck) throw new Error('deck not found')
  const settings = deck.settings ?? {}
  const cards = listCards(db, userId, deckId)
  const known = cards.map((c) => c.back)
  const count = clamp(opts.count ?? settings.batchSize ?? 10, 1, 50)
  const cursor = settings.cursor ?? 0

  // An imported deck grows from its stored word list; a frequency deck re-pulls.
  let sourceWords: string[]
  if (settings.words?.length) {
    sourceWords = settings.words
  } else {
    const { words } = await fetchFrequencyWords(deck.targetLang, {
      variant: settings.variant,
      fetcher: opts.fetcher,
      limit: cursor + count * 8 + 200,
    })
    sourceWords = words.map((w) => w.word)
  }
  const remaining = sourceWords.slice(cursor).filter((w) => !known.includes(w))

  // A deck's own prompt wins. Older imported decks only carry the generic
  // "Build a deck from the imported deck …" wording, so they pick up the
  // learner's remembered prompt instead of losing it on the next batch.
  const genericPrompt =
    !settings.instruction || settings.instruction.startsWith('Build a deck from the imported deck ')
  const instruction = genericPrompt
    ? (rememberedDeckInstruction(db, userId) ?? settings.instruction ?? 'Continue the deck')
    : (settings.instruction ?? 'Continue the deck')

  const planned = await opts.planner({
    // The prompt that built the deck stays in force for every later batch; a
    // topic narrows the batch without replacing the learner's rules.
    instruction,
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    topic: opts.topic,
    words: remaining,
    knownWords: known,
    variant: settings.variant,
    readingScript: settings.readingScript,
    count,
    pitchAccent: settings.pitchAccent,
  })
  applyDictionaryPitch(deck.targetLang, settings.pitchAccent, planned)
  applyDictionaryReading(deck.targetLang, settings.readingScript, undefined, planned)

  const { newWords, cardCount } = persistCards(
    db,
    userId,
    deckId,
    {
      targetLang: deck.targetLang,
      sourceLang: deck.sourceLang,
      readingScript: settings.readingScript,
      startStep: maxStep(cards),
    },
    planned,
  )
  updateDeckSettings(db, deckId, userId, {
    cursor: cursor + count,
    batchSize: count,
    instruction,
  })
  return {
    deckId,
    name: deck.name,
    cardCount: cards.length + cardCount,
    source:
      settings.wordSource === 'anki'
        ? 'uploaded deck'
        : (frequencySourceFor(deck.targetLang, settings.variant)?.label ?? deck.targetLang),
    newWords,
  }
}
