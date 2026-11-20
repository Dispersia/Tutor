import { api } from './api'
import type { SkillOutcome } from './skills'
import type { Card, CardTemplate } from './types'

export interface Instance {
  exerciseId: string
  cardId: string
  modality: string
  prompt: string
  data: Record<string, unknown>
}

/** Today's Anki-style study budget (new cards / reviews left). */
export interface StudyBudget {
  newPerDay: number
  maxReviewsPerDay: number
  newToday: number
  reviewsToday: number
  newRemaining: number
  reviewsRemaining: number
  newUnlimited: boolean
  reviewsUnlimited: boolean
}

export interface Grade {
  score: number
  correct: boolean
  expected?: string
  feedback?: string
  xp: number
  leveledUp?: boolean
  detail?: Record<string, unknown>
}

/** FSRS-6 scheduling outcome for the reviewed card (Anki-style). */
export interface SrsOutcome {
  rating: 1 | 2 | 3 | 4
  state: 'new' | 'learning' | 'review' | 'relearning'
  intervalDays: number
  dueAt: number
  stability: number
  difficulty: number
  step: number
  reps: number
  lapses: number
}

/** A deck's own overrides (ruby/reading rules, variant, growth cursor). */
export interface DeckSettings {
  showReadings?: boolean
  readingScript?: string
  variant?: 'traditional' | 'simplified'
  /** Ask the generator for pitch-accent metadata (Japanese, …). */
  pitchAccent?: boolean
  disabledExercises?: string[]
  cursor?: number
  batchSize?: number
  instruction?: string
  /** True while a background build is still generating this deck's cards. */
  building?: boolean
  /** How many words the running build will introduce in total. */
  buildTotal?: number
  /** The error that stopped a background build. */
  buildError?: string
}

export interface Deck {
  id: string
  name: string
  sourceLang: string
  targetLang: string
  level: string | null
  description: string | null
  cardCount: number
  settings?: DeckSettings
}

/** A deck built or grown from an instruction + a pulled frequency list. */
export interface BuiltDeck {
  deck: Deck
  cardCount: number
  source: string
  newWords: string[]
}

/** One day of the activity map: the UTC day and the XP earned in it. */
export interface ActivityDay {
  day: string
  xp: number
}

export interface Stats {
  /** lifetime review XP (daily-goal / heat-map metric) */
  xp: number
  /** the account level: the mean of every profession, out of 100 */
  level: number
  /** how far the average profession is toward its next level (0..1) */
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
  /** Daily XP heat-map grid: weeks as columns (Monday first), oldest day first. */
  activity?: { today: string; days: ActivityDay[] }
  /** epoch ms when the "can't speak or listen" window lifts; 0 when off. */
  quietUntil?: number
}

export const listDecks = () => api<{ decks: Deck[] }>('/api/decks')

/** Build a deck from an instruction; the server pulls a frequency list for it. */
export const createDeck = (body: {
  instruction: string
  targetLang?: string
  topic?: string
  count?: number
  name?: string
}) => api<BuiltDeck>('/api/decks', { method: 'POST', body: JSON.stringify(body) })

/** What an uploaded Anki deck looks like before the learner picks its fields. */
export interface AnkiInspection {
  name?: string
  fields: string[]
  sample: string[][]
  noteCount: number
  /** Best-guess indices, used only to pre-select the pickers. */
  suggested: { wordField: number; readingField: number; meaningField: number }
  /** Target language guessed from the deck's script (kana → Japanese, …). */
  suggestedLang?: string
}

/** Inspect an uploaded Anki `.apkg` (field names + preview) before importing. */
export const inspectDeck = (form: FormData) =>
  api<AnkiInspection>('/api/decks/inspect', { method: 'POST', body: form })

/** Import an Anki `.apkg`: its words become the deck's word source. The whole
 *  deck is imported and filled in the background — `building` says it is still
 *  generating cards. */
export const importDeck = (form: FormData) =>
  api<BuiltDeck & { words: number; fields: string[]; building?: boolean }>('/api/decks/import', {
    method: 'POST',
    body: form,
  })

/**
 * Grow a deck organically, optionally focusing on a topic. With `all: true` the
 * server finishes the deck in the background — every remaining source word.
 */
export const growDeck = (
  deckId: string,
  body: { topic?: string; count?: number; all?: boolean } = {},
) => api<BuiltDeck>(`/api/decks/${deckId}/grow`, { method: 'POST', body: JSON.stringify(body) })

/** Update a deck's own rules (e.g. hide readings for this deck). */
export const updateDeck = (deckId: string, body: { name?: string; settings?: DeckSettings }) =>
  api<{ deck: Deck; settings?: DeckSettings }>(`/api/decks/${deckId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

/** Delete a deck completely: cards, SRS state, history and deck chats. */
export const deleteDeck = (deckId: string) =>
  api<{ ok: boolean; deckId: string }>(`/api/decks/${deckId}`, { method: 'DELETE' })

/**
 * Annotate pitch metadata. The bundled Japanese dictionary answers first and the
 * generator fills the gaps; with `force` every card is re-annotated from the
 * dictionary alone (replaces wrong contours, no key needed).
 */
export const backfillPitch = (deckId: string, opts: { force?: boolean } = {}) =>
  api<{ updated: number; total: number }>(`/api/decks/${deckId}/pitch`, {
    method: 'POST',
    ...(opts.force ? { body: JSON.stringify({ force: true }) } : {}),
  })

/** Every card in a deck (with its readings, payload and metadata). */
export const getDeckCards = (deckId: string) =>
  api<{ deck: Deck; cards: Card[] }>(`/api/decks/${deckId}/cards`)

/** A card edit: content and/or the language-agnostic metadata bag. */
export interface CardPatch {
  front?: string
  back?: string
  readings?: Record<string, string>
  /** Merged by key server-side; `null` removes an annotation. */
  metadata?: Record<string, unknown>
}

/** Update one card's content; metadata is merged by key. */
export const updateDeckCard = (deckId: string, cardId: string, patch: CardPatch) =>
  api<{ card: Card }>(`/api/decks/${deckId}/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

/** Add a card to a deck; `step` places it in that lesson (n+1 group). */
export const addDeckCard = (
  deckId: string,
  body: { front: string; back: string; type?: string; reading?: string; step?: number },
) =>
  api<{ card: Card; step: number }>(`/api/decks/${deckId}/cards`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const listExercises = () =>
  api<{ exercises: { id: string; title: string; modality: string }[] }>('/api/exercises')

/** The reusable card templates (vocab, spoken, listening, sentence, grammar). */
export const listTemplates = () => api<{ templates: CardTemplate[] }>('/api/templates')
export const getStats = () => api<Stats>('/api/stats')

export const nextExercise = (body: {
  deckId?: string
  exerciseId?: string
  actionId?: string
  lessonId?: string
}) =>
  api<{
    instance: Instance | null
    action: { id: string; skillId: string; xp: number } | null
    /** Set when the daily budget is spent and nothing can be served. */
    done?: boolean
    budget?: StudyBudget
    /** The step the served card belongs to (the header follows the queue). */
    lessonId?: string
  }>('/api/practice/next', { method: 'POST', body: JSON.stringify(body) })

/** Raises today's new/review allowance (Anki's "study more"). */
export const studyMore = () =>
  api<{ ok: boolean; budget: StudyBudget }>('/api/study/more', {
    method: 'POST',
    body: '{}',
  })

/** Turns the "can't speak or listen right now" option on (15 min) or off. */
export const setQuiet = (enabled: boolean) =>
  api<{ quietUntil: number }>('/api/practice/quiet', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })

export const gradeExercise = (body: {
  exerciseId: string
  cardId: string
  answer: unknown
  latencyMs?: number
  actionId?: string
  lessonId?: string
}) =>
  api<{
    result: Grade
    skill: SkillOutcome | null
    srs?: SrsOutcome
    lessonCompleted?: boolean
    stats: Stats
  }>('/api/practice/grade', { method: 'POST', body: JSON.stringify(body) })

/** Recorded-audio grading (pronunciation) — multipart to /api/practice/speak. */
export const gradeSpeak = (form: FormData) =>
  api<{
    result: Grade
    skill: SkillOutcome | null
    srs?: SrsOutcome
    lessonCompleted?: boolean
    stats: Stats
  }>('/api/practice/speak', { method: 'POST', body: form })

export interface WordFeedback {
  text: string
  ok: boolean
  tip?: string
}
