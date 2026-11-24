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
  count?: number
  name?: string
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
  if (targetLang !== 'zh' || readingScript === 'pinyin') return
  for (const card of planned) {
    if (hints?.[card.back]?.reading) continue
    const word = mandarinZhuyin(card.back)
    if (word) card.reading = word
    else if (!card.reading) card.reading = mandarinSentenceZhuyin(card.back)
  }
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

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/

function unseenTokens(targetLang: string, card: PlannedCard, known: ReadonlySet<string>): boolean {
  if (targetLang !== 'zh' && targetLang !== 'yue') return false
  if (card.template !== 'sentence') return false
  const tokens = stringsOf(card.payload?.tokens)
  const distractors = stringsOf(card.payload?.distractors)
  return [...tokens, ...distractors].some((word) => !wordKnown(word, known))
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function wordKnown(word: string, known: ReadonlySet<string>): boolean {
  if (known.has(word)) return true
  const chars = [...word].filter((ch) => HAN.test(ch))
  return chars.length === 0 || chars.every((ch) => known.has(ch))
}

const CLAUSE_FINAL_DEMONSTRATIVE = /[來来去][這这那](?=[，。、！？,.!?\s]|$)/u

export function motionWithoutPlace(targetLang: string, card: PlannedCard): boolean {
  if (targetLang !== 'zh' && targetLang !== 'yue') return false
  return card.template === 'sentence' && CLAUSE_FINAL_DEMONSTRATIVE.test(card.back)
}

function skipExample(card: PlannedCard, opts: PersistOpts, known: ReadonlySet<string>): boolean {
  if (leapsAhead(card, opts.futureWords)) return true
  if (unseenTokens(opts.targetLang, card, known)) return true
  return motionWithoutPlace(opts.targetLang, card)
}

export function persistCards(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  opts: PersistOpts,
  planned: PlannedCard[],
): { newWords: string[]; cardCount: number } {
  let step = opts.startStep
  const newWords: string[] = []
  const known = new Set(opts.knownWords ?? [])
  let cardCount = 0
  for (const c of planned) {
    step = bookkeep(c, opts, step, newWords, known)
    if (c.template !== 'vocab' && skipExample(c, opts, known)) continue
    persistOne({ db, userId, deckId, opts, card: c, step: Math.max(step, 1) })
    cardCount++
  }
  return { newWords, cardCount }
}

function bookkeep(
  c: PlannedCard,
  opts: PersistOpts,
  step: number,
  newWords: string[],
  known: Set<string>,
): number {
  if (c.template !== 'vocab') return step
  newWords.push(c.back)
  known.add(c.back)
  opts.futureWords.delete(c.back)
  return step + 1
}

interface PersistOpts {
  targetLang: string
  sourceLang: string
  readingScript?: string
  startStep: number
  futureWords: Set<string>
  knownWords?: string[]
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
