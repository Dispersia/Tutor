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
 * rules. An imported deck brings its own ordered word list, so it can generate
 * the whole thing at once — one LLM call per {@link PLAN_CHUNK} words, with the
 * words already introduced carried forward so sentence/grammar cards stay n+1.
 * Both the fetcher and the planner are injected so tests run offline.
 */

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
  deckId: string
  name: string
  cardCount: number
  /** The frequency list it was built from, e.g. "zh_tw (Traditional)". */
  source: string
  /** The words this batch introduced. */
  newWords: string[]
}

/**
 * Words per planner call. Small enough that a batch (one vocab card per word
 * plus the interleaved sentence/grammar cards) stays inside the model's output
 * budget, large enough that a 1500-word import is not 1500 calls. A batch that
 * still comes back truncated is retried smaller — see {@link fillDeck}.
 */
export const PLAN_CHUNK = 20

/** A deck never asks for more words than the importer will even read. */
export const MAX_DECK_WORDS = 5000

const DEFAULT_COUNT = 20

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
function persistCards(
  db: Db,
  userId: string,
  deckId: string,
  opts: {
    targetLang: string
    sourceLang: string
    readingScript?: string
    startStep: number
    futureWords: Set<string>
  },
  planned: PlannedCard[],
): { newWords: string[]; cardCount: number } {
  let step = opts.startStep
  const newWords: string[] = []
  let cardCount = 0
  for (const c of planned) {
    if (c.template === 'vocab') {
      step++
      newWords.push(c.back)
      opts.futureWords.delete(c.back)
    } else if (leapsAhead(c, opts.futureWords)) {
      continue
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

/** Turns a `BuildDeckOptions` into the deck-wide context the planner needs. */
function contextFrom(opts: BuildDeckOptions): DeckContext {
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

export interface CreateDeckResult {
  deckId: string
  name: string
  /** The ordered words the deck will introduce. */
  candidates: string[]
  /** The provenance label, e.g. "uploaded deck" or the frequency source. */
  sourceLabel: string
  /** How many words the caller asked for (already clamped). */
  count: number
}

/**
 * Creates the deck and stores its rules without generating a single card. The
 * synchronous build fills it right away; an import can return this to the
 * learner at once and then fill it in the background.
 */
export async function createDeckForBuild(
  db: Db,
  userId: string,
  opts: BuildDeckOptions,
): Promise<CreateDeckResult> {
  const count = clamp(opts.count ?? DEFAULT_COUNT, 1, MAX_DECK_WORDS)

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
      limit: clamp(count + 200, 300, MAX_DECK_WORDS),
    })
    candidates = words.map((w) => w.word)
    sourceLabel = source.label
    wordSource = 'frequency'
  }

  const settings: DeckSettings = {
    variant: opts.variant,
    readingScript: opts.readingScript,
    showReadings: opts.showReadings,
    disabledExercises: opts.disabledExercises,
    pitchAccent: opts.pitchAccent,
    cursor: 0,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: opts.instruction,
    wordSource,
    // keep the source list so an imported deck can keep growing without it
    words: wordSource === 'anki' ? candidates.slice(0, MAX_DECK_WORDS) : undefined,
  }
  const name = opts.name?.trim() || `${opts.topic ?? opts.targetLang} · generated`
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Generated from ${sourceLabel}`,
    settings,
  })
  return { deckId: deck.id, name, candidates, sourceLabel, count }
}

export interface FillDeckOptions {
  /** The words to introduce, in order (frequency order or the deck's own). */
  words: string[]
  /** How many of them to introduce (≤ words.length). */
  count: number
  /** Words already in the deck, so example cards stay n+1. */
  knownWords?: string[]
  /** The n+1 step to continue from. */
  startStep?: number
  /** Called after every batch with (words introduced, total requested). */
  onProgress?: (built: number, total: number) => void
}

export interface FillDeckResult {
  newWords: string[]
  cardCount: number
  /** How many words were actually introduced. */
  built: number
}

/**
 * Plans and persists a deck's cards in {@link PLAN_CHUNK}-word batches. Each
 * batch carries the words already introduced, so the planner's sentence and
 * grammar cards only ever use what the learner has met. Persisting batch by
 * batch means a long build is durable: an interrupted import keeps what it made.
 *
 * A batch whose JSON came back truncated (the model hit its output cap) is
 * retried with half the words, down to a single word — the build shrinks around
 * a fussy batch rather than giving up on the whole deck, then widens again.
 */
export async function fillDeck(
  db: Db,
  userId: string,
  deckId: string,
  ctx: DeckContext,
  opts: FillDeckOptions,
  planner: Planner,
): Promise<FillDeckResult> {
  const total = clamp(opts.count, 0, opts.words.length)
  const known = [...(opts.knownWords ?? [])]
  // Words still waiting to be introduced, shared across batches so a card can
  // never reach ahead to a word a later batch will teach (strict n+1).
  const future = new Set(opts.words)
  for (const w of known) future.delete(w)
  const newWords: string[] = []
  let cardCount = 0
  let step = opts.startStep ?? 0
  let built = 0
  let chunkSize = PLAN_CHUNK

  while (built < total) {
    const size = Math.min(chunkSize, total - built)
    const chunk = opts.words.slice(built, built + size)
    let planned: PlannedCard[]
    try {
      planned = await planner({
        instruction: ctx.instruction,
        targetLang: ctx.targetLang,
        sourceLang: ctx.sourceLang,
        topic: ctx.topic,
        words: chunk,
        knownWords: known.slice(),
        variant: ctx.variant,
        readingScript: ctx.readingScript,
        count: size,
        pitchAccent: ctx.pitchAccent,
        hints: ctx.hints,
      })
    } catch (err) {
      // Retry the same words with a smaller batch. A single word that still
      // fails is a real error — stop there, keeping everything already made.
      if (size > 1) {
        chunkSize = Math.max(1, Math.floor(size / 2))
        continue
      }
      throw err
    }
    applyDictionaryPitch(ctx.targetLang, ctx.pitchAccent, planned)
    applyDictionaryReading(ctx.targetLang, ctx.readingScript, ctx.hints, planned)
    const res = persistCards(
      db,
      userId,
      deckId,
      {
        targetLang: ctx.targetLang,
        sourceLang: ctx.sourceLang,
        readingScript: ctx.readingScript,
        startStep: step,
        futureWords: future,
      },
      planned,
    )
    step += res.newWords.length
    known.push(...res.newWords)
    newWords.push(...res.newWords)
    cardCount += res.cardCount
    built += size
    opts.onProgress?.(built, total)
    // Recover the batch size one word at a time after a shrink.
    if (chunkSize < PLAN_CHUNK) chunkSize = Math.min(PLAN_CHUNK, chunkSize + 1)
  }
  return { newWords, cardCount, built }
}

/**
 * Builds a new deck from an instruction: pulls a frequency list, generates its
 * cards (n+1), and stores the deck with its own settings. Synchronous — the
 * import path uses {@link startDeckBuild} so the learner is not left waiting.
 */
export async function buildDeck(
  db: Db,
  userId: string,
  opts: BuildDeckOptions,
): Promise<BuiltDeck> {
  const created = await createDeckForBuild(db, userId, opts)
  const { newWords, cardCount, built } = await fillDeck(
    db,
    userId,
    created.deckId,
    contextFrom(opts),
    { words: created.candidates, count: created.count, knownWords: [], startStep: 0 },
    opts.planner,
  )
  updateDeckSettings(db, created.deckId, userId, { cursor: built })
  return {
    deckId: created.deckId,
    name: created.name,
    cardCount,
    source: created.sourceLabel,
    newWords,
  }
}

/** The words, rules and n+1 state one organic growth run works from. */
export interface GrowthPlan {
  instruction: string
  ctx: DeckContext
  /** The words still to introduce, in order. */
  words: string[]
  /** Words already in the deck, so example cards stay n+1. */
  knownWords: string[]
  /** The n+1 step to continue from. */
  startStep: number
  /** The index into the deck's source list this growth starts at. */
  cursor: number
}

/**
 * Reads a deck's next growth batch: its remaining words, its rules and the n+1
 * state to carry forward. An imported deck grows from its stored word list; a
 * frequency deck re-pulls `want` words' worth (plus headroom).
 */
export async function growthPlan(
  db: Db,
  userId: string,
  deckId: string,
  opts: { topic?: string; fetcher?: Fetcher; want?: number } = {},
): Promise<GrowthPlan | undefined> {
  const deck = getDeck(db, deckId, userId)
  if (!deck) return undefined
  const settings = deck.settings ?? {}
  const cards = listCards(db, userId, deckId)
  const known = cards.map((c) => c.back)
  const cursor = settings.cursor ?? 0
  const want = clamp(opts.want ?? PLAN_CHUNK, 1, MAX_DECK_WORDS)

  let sourceWords: string[]
  if (settings.words?.length) {
    sourceWords = settings.words
  } else {
    const { words } = await fetchFrequencyWords(deck.targetLang, {
      variant: settings.variant,
      fetcher: opts.fetcher,
      limit: clamp(cursor + want + 200, 300, MAX_DECK_WORDS),
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

  return {
    instruction,
    ctx: {
      // The prompt that built the deck stays in force for every later batch; a
      // topic narrows the batch without replacing the learner's rules.
      instruction,
      targetLang: deck.targetLang,
      sourceLang: deck.sourceLang,
      topic: opts.topic,
      variant: settings.variant,
      readingScript: settings.readingScript,
      pitchAccent: settings.pitchAccent,
    },
    words: remaining,
    knownWords: known,
    startStep: maxStep(cards),
    cursor,
  }
}

/**
 * Grows a deck organically: adds another n+1 batch from its frequency list (or
 * its stored word list). `topic` narrows the batch to a theme (e.g. a
 * restaurant). Synchronous — {@link startDeckGrowth} finishes it in the
 * background instead.
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
  const count = clamp(opts.count ?? settings.batchSize ?? 10, 1, MAX_DECK_WORDS)
  const plan = await growthPlan(db, userId, deckId, {
    topic: opts.topic,
    fetcher: opts.fetcher,
    want: count,
  })
  if (!plan) throw new Error('deck not found')

  const { newWords, cardCount } = await fillDeck(
    db,
    userId,
    deckId,
    plan.ctx,
    {
      words: plan.words,
      count,
      knownWords: plan.knownWords,
      startStep: plan.startStep,
    },
    opts.planner,
  )
  updateDeckSettings(db, deckId, userId, {
    cursor: plan.cursor + count,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: plan.instruction,
    buildError: undefined,
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

/**
 * Finishes a deck in the background: introduces every remaining word so an
 * interrupted or stopped build resumes with one action. Returns how many words
 * were left (0 when the deck was already complete).
 */
export async function startDeckGrowth(
  db: Db,
  userId: string,
  deckId: string,
  opts: { topic?: string; fetcher?: Fetcher; planner: Planner },
): Promise<number | undefined> {
  const plan = await growthPlan(db, userId, deckId, {
    topic: opts.topic,
    fetcher: opts.fetcher,
    want: MAX_DECK_WORDS,
  })
  if (!plan) return undefined
  if (plan.words.length === 0) {
    updateDeckSettings(db, deckId, userId, { building: false, buildError: undefined })
    return 0
  }
  const total = plan.cursor + plan.words.length
  updateDeckSettings(db, deckId, userId, {
    building: true,
    buildTotal: total,
    buildError: undefined,
  })
  startDeckBuild(
    db,
    userId,
    deckId,
    plan.ctx,
    {
      words: plan.words,
      count: plan.words.length,
      knownWords: plan.knownWords,
      startStep: plan.startStep,
    },
    opts.planner,
    { cursorStart: plan.cursor, total },
  )
  return plan.words.length
}

/**
 * In-flight background builds, keyed by deck id, so a caller (or a test) can
 * wait for the work the HTTP response did not. Entries clear when they finish.
 */
const builds = new Map<string, Promise<void>>()

/** Waits for a deck's background build, resolving at once when none is running. */
export function awaitDeckBuild(deckId: string): Promise<void> {
  return builds.get(deckId) ?? Promise.resolve()
}

/**
 * Fills a deck in the background. The HTTP handler returns as soon as the deck
 * exists, and this keeps generating cards in batches, writing the growth cursor
 * after each one so the UI can watch the deck fill. The `building` flag is the
 * learner-visible status; it clears on success or error (and a restart clears
 * it too — see `clearDeckBuilds`).
 *
 * `base` places the run inside the deck's source list — an import starts at 0,
 * a resume continues from the cursor it stopped at.
 */
export function startDeckBuild(
  db: Db,
  userId: string,
  deckId: string,
  ctx: DeckContext,
  opts: FillDeckOptions,
  planner: Planner,
  base: { cursorStart?: number; total?: number } = {},
): void {
  const start = base.cursorStart ?? 0
  const total = base.total ?? opts.count
  const run = (async () => {
    try {
      await fillDeck(
        db,
        userId,
        deckId,
        ctx,
        {
          ...opts,
          onProgress: (built, chunkTotal) => {
            opts.onProgress?.(built, chunkTotal)
            updateDeckSettings(db, deckId, userId, { cursor: start + built, buildTotal: total })
          },
        },
        planner,
      )
      updateDeckSettings(db, deckId, userId, {
        building: false,
        cursor: start + opts.count,
        buildTotal: total,
        buildError: undefined,
      })
    } catch (err) {
      updateDeckSettings(db, deckId, userId, {
        building: false,
        buildError: (err as Error).message,
      })
    } finally {
      builds.delete(deckId)
    }
  })()
  builds.set(deckId, run)
}
