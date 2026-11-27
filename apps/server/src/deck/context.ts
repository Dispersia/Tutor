import type { UserId, DeckId } from '../ids'
import type { CardType } from '@tutor/core'
import { addCard, listCards } from '../db/repo'
import type { Db } from '../db/client'
import type { CharacterVariant, Fetcher } from '../frequency/source'
import type { PlannedCard, Planner } from './plan'
import { storedTemplate } from './plan'
import type { Reviewer } from './review'
import { kanjiumContour } from './kanjium'
import { loadLexicon } from './lexicon'
import { mandarinSentenceZhuyin, mandarinZhuyin } from './mandarin'
import { kanaFromWords, storedReadings } from '../text/readings'
import { wordKey } from '../text/normalize'

export interface BuildDeckOptions {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
  count?: number
  name?: string
  kind?: 'path' | 'custom'
  variant?: CharacterVariant
  readingScript?: string
  showReadings?: boolean
  disabledExercises?: string[]
  pitchAccent?: boolean
  words?: string[]
  sourceLabel?: string
  hints?: Record<string, { reading?: string; meaning?: string }>
  fetcher?: Fetcher
  planner: Planner
  reviewer?: Reviewer
}

export interface GrowDeckOptions {
  count?: number
  topic?: string
  fetcher?: Fetcher
  planner: Planner
  reviewer?: Reviewer
}

export interface BuiltDeck {
  deckId: DeckId
  name: string
  cardCount: number
  source: string
  newWords: string[]
}

export interface DeckContext {
  instruction: string
  targetLang: string
  sourceLang: string
  topic?: string
  variant?: CharacterVariant
  readingScript?: string
  pitchAccent?: boolean
  hints?: Record<string, { reading?: string; meaning?: string }>
}

export function readingsForPlanned(
  targetLang: string,
  reading: string | undefined,
  script: string | undefined,
  back?: string,
): Record<string, string> {
  const fallbackZhuyin = () => (back ? mandarinSentenceZhuyin(back) : undefined)
  return storedReadings({ targetLang, reading, script, fallbackZhuyin })
}

export { zhuyinFromPinyin } from '../text/readings'

function cardTypeFor(template: PlannedCard['template']): CardType {
  if (template === 'sentence') return 'phrase'
  if (template === 'grammar') return 'grammar'
  return 'vocab'
}

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

export function applyDictionaryReading(
  targetLang: string,
  readingScript: string | undefined,
  hints: Record<string, { reading?: string; meaning?: string }> | undefined,
  planned: PlannedCard[],
): void {
  if (targetLang === 'ja') return applyJapaneseReading(hints, planned)
  if (targetLang !== 'zh' || readingScript === 'pinyin') return
  for (const card of planned) {
    if (hints?.[card.back]?.reading) continue
    const word = mandarinZhuyin(card.back)
    if (word) card.reading = word
    else if (!card.reading) card.reading = mandarinSentenceZhuyin(card.back)
  }
}

function applyJapaneseReading(
  hints: Record<string, { reading?: string; meaning?: string }> | undefined,
  planned: PlannedCard[],
): void {
  const lexicon = loadLexicon('ja')
  if (!lexicon) return
  const readingOf = (word: string) => hints?.[word]?.reading ?? lexicon.get(word)?.reading
  for (const card of planned) {
    const words = cardWords(card)
    if (!words) continue
    const reading = kanaFromWords(words, readingOf)
    if (reading) card.reading = reading
  }
}

function cardWords(card: PlannedCard): string[] | undefined {
  if (card.template === 'sentence') {
    const tokens = stringsOf(card.payload?.tokens)
    return tokens.length > 0 ? tokens : undefined
  }
  return card.template === 'vocab' ? [card.back] : undefined
}

export function maxStep(cards: { payload: Record<string, unknown> }[]): number {
  let max = 0
  for (const c of cards) {
    const s = c.payload?.step
    if (typeof s === 'number' && s > max) max = s
  }
  return max
}

export function leapsAhead(card: PlannedCard, future: ReadonlySet<string>): boolean {
  if (future.size === 0) return false
  const { tokens, distractors, answer } = card.payload ?? {}
  if (hasFuture(tokens, future) || hasFuture(distractors, future)) return true
  if (typeof answer === 'string' && future.has(answer)) return true
  return future.has(card.back)
}

function hasFuture(value: unknown, future: ReadonlySet<string>): boolean {
  return Array.isArray(value) && value.some((t) => typeof t === 'string' && future.has(t))
}

export interface UnseenParts {
  words: string[]
  distractors: string[]
}

export function unseenParts(card: PlannedCard, known: ReadonlySet<string>): UnseenParts {
  return {
    words: notMet(wordFields(card), known),
    distractors: notMet(distractorFields(card), known),
  }
}

function hasUnseen(parts: UnseenParts): boolean {
  return parts.words.length > 0 || parts.distractors.length > 0
}

function notMet(words: string[], known: ReadonlySet<string>): string[] {
  return words.filter((word) => !wordKnown(word, known))
}

function wordFields(card: PlannedCard): string[] {
  if (card.template === 'sentence') return sentenceWords(card)
  if (card.template === 'grammar') return grammarWords(card.payload)
  return []
}

function sentenceWords(card: PlannedCard): string[] {
  const tokens = stringsOf(card.payload?.tokens)
  return tokens.length ? tokens : wordsIn(card.back)
}

function distractorFields(card: PlannedCard): string[] {
  return card.template === 'sentence' ? stringsOf(card.payload?.distractors) : []
}

function grammarWords(payload: Record<string, unknown> | undefined): string[] {
  const answer = typeof payload?.answer === 'string' ? [payload.answer] : []
  const prompt = typeof payload?.prompt === 'string' ? wordsIn(payload.prompt) : []
  return [...answer, ...prompt]
}

const WORD_RUN = /\p{L}[\p{L}\p{N}]*/gu

function wordsIn(text: string): string[] {
  return text.match(WORD_RUN) ?? []
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function wordKnown(word: string, known: ReadonlySet<string>): boolean {
  if (known.has(word)) return true
  const runs = wordsIn(word)
  if (runs.length === 0) return true
  return runs.every((run) => runKnown(run, known))
}

function runKnown(run: string, known: ReadonlySet<string>): boolean {
  let at = 0
  while (at < run.length) {
    const len = longestKnown(run, at, known)
    if (len === 0) return false
    at += len
  }
  return true
}

function longestKnown(run: string, at: number, known: ReadonlySet<string>): number {
  for (let len = run.length - at; len > 0; len--) {
    if (known.has(run.slice(at, at + len))) return len
  }
  return 0
}

const CLAUSE_FINAL_DEMONSTRATIVE = /[來来去][這这那](?=[，。、！？,.!?\s]|$)/u

export function motionWithoutPlace(targetLang: string, card: PlannedCard): boolean {
  if (targetLang !== 'zh' && targetLang !== 'yue') return false
  return card.template === 'sentence' && CLAUSE_FINAL_DEMONSTRATIVE.test(card.back)
}

export function exampleFails(
  targetLang: string,
  card: PlannedCard,
  futureWords: ReadonlySet<string>,
  known: ReadonlySet<string>,
): boolean {
  if (leapsAhead(card, futureWords)) return true
  if (hasUnseen(unseenParts(card, known))) return true
  return motionWithoutPlace(targetLang, card)
}

export function pruneDistractors(
  card: PlannedCard,
  futureWords: ReadonlySet<string>,
  known: ReadonlySet<string>,
): void {
  if (card.template !== 'sentence' || !card.payload) return
  const raw = card.payload.distractors
  if (!Array.isArray(raw)) return
  card.payload.distractors = raw
    .filter((d): d is string => typeof d === 'string')
    .filter((d) => !futureWords.has(d) && wordKnown(d, known))
}

function skipExample(card: PlannedCard, opts: PersistOpts, known: ReadonlySet<string>): boolean {
  return exampleFails(opts.targetLang, card, opts.futureWords, known)
}

interface PersistRun {
  db: Db
  userId: UserId
  deckId: DeckId
  opts: PersistOpts
  newWords: string[]
  known: Set<string>
  sentenced: Set<string>
  dropped: { word: string; step: number }[]
  written: Set<string>
  step: number
  anchor: string
  cardCount: number
}

export function persistCards(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: PersistOpts,
  planned: PlannedCard[],
): { newWords: string[]; cardCount: number; sentenced: Set<string>; dropped: PersistDrop[] } {
  const run = newPersistRun(db, userId, deckId, opts)
  for (const c of planned) persistStep(run, c)
  return {
    newWords: run.newWords,
    cardCount: run.cardCount,
    sentenced: run.sentenced,
    dropped: run.dropped,
  }
}

export interface PersistDrop {
  word: string
  step: number
}

function newPersistRun(db: Db, userId: UserId, deckId: DeckId, opts: PersistOpts): PersistRun {
  const written = opts.written ?? storedKeys(db, userId, deckId)
  opts.written = written
  return {
    db,
    userId,
    deckId,
    opts,
    newWords: [],
    known: new Set(opts.knownWords ?? []),
    sentenced: new Set(),
    dropped: [],
    written,
    step: opts.startStep,
    anchor: '',
    cardCount: 0,
  }
}

export function storedKeys(db: Db, userId: UserId, deckId: DeckId): Set<string> {
  return new Set(listCards(db, userId, deckId).map((c) => cardKey(c.payload.template, c.back)))
}

function cardKey(template: unknown, back: string): string {
  return `${typeof template === 'string' ? template : 'vocab'}|${wordKey(back)}`
}

function persistStep(run: PersistRun, c: PlannedCard): void {
  const intro = introduces(c, run)
  bookkeep(run, c, intro)
  if (intro) run.anchor = c.back
  pruneDistractors(c, run.opts.futureWords, run.known)
  if (skips(run, c, intro)) return
  const { db, userId, deckId, opts } = run
  if (!persistOne({ db, userId, deckId, opts, card: c, step: Math.max(run.step, 1) })) return
  run.cardCount++
  if (c.template === 'sentence' && run.anchor) run.sentenced.add(run.anchor)
}

function skips(run: PersistRun, card: PlannedCard, intro: boolean): boolean {
  if (oneWordSentence(card, run.known)) return true
  if (card.template === 'vocab' || !skipExample(card, run.opts, run.known)) return false
  if (intro) run.dropped.push({ word: card.back, step: Math.max(run.step, 1) })
  return true
}

function oneWordSentence(card: PlannedCard, known: Set<string>): boolean {
  if (card.template !== 'sentence' || storedTemplate(card) !== 'vocab') return false
  return stringsOf(card.payload?.tokens).some((token) => known.has(token))
}

function introduces(c: PlannedCard, run: PersistRun): boolean {
  if (c.template === 'vocab') return !run.known.has(c.back)
  return c.template === 'grammar' && c.payload?.intro === true
}

function bookkeep(run: PersistRun, c: PlannedCard, intro: boolean): void {
  if (!intro) return
  run.newWords.push(c.back)
  run.known.add(c.back)
  run.opts.futureWords.delete(c.back)
  run.step += 1
}

export interface PersistOpts {
  targetLang: string
  sourceLang: string
  readingScript?: string
  startStep: number
  futureWords: Set<string>
  knownWords?: string[]
  written?: Set<string>
}

interface PersistReq {
  db: Db
  userId: UserId
  deckId: DeckId
  opts: PersistOpts
  card: PlannedCard
  step: number
}

export function persistOne(req: PersistReq): boolean {
  const { db, userId, deckId, opts, card: c } = req
  const template = storedTemplate(c)
  const written = opts.written ?? storedKeys(db, userId, deckId)
  const key = cardKey(template, c.back)
  if (written.has(key)) return false
  written.add(key)
  storeCard(req, template)
  return true
}

function storeCard(req: PersistReq, template: PlannedCard['template']): void {
  const { db, userId, deckId, opts, card: c, step } = req
  addCard(db, userId, {
    deckId,
    type: cardTypeFor(template),
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    front: c.front,
    back: c.back,
    readings: readingsForPlanned(opts.targetLang, c.reading, opts.readingScript, c.back),
    tags: [opts.targetLang, template],
    payload: { ...(c.payload ?? {}), template, step },
    metadata: c.metadata,
    origin: 'llm',
  })
}

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
