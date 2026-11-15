import { api } from './api'
import type { SkillOutcome } from './skills'
import type { CardTemplate } from './types'

export interface Instance {
  exerciseId: string
  cardId: string
  modality: string
  prompt: string
  data: Record<string, unknown>
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
  disabledExercises?: string[]
  cursor?: number
  batchSize?: number
  instruction?: string
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

export interface Stats {
  xp: number
  level: number
  intoLevel: number
  forNext: number
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
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
}

/** Inspect an uploaded Anki `.apkg` (field names + preview) before importing. */
export const inspectDeck = (form: FormData) =>
  api<AnkiInspection>('/api/decks/inspect', { method: 'POST', body: form })

/** Import an Anki `.apkg`: its words become the deck's word source. */
export const importDeck = (form: FormData) =>
  api<BuiltDeck & { words: number; fields: string[] }>('/api/decks/import', {
    method: 'POST',
    body: form,
  })

/** Grow a deck organically, optionally focusing on a topic. */
export const growDeck = (deckId: string, body: { topic?: string; count?: number } = {}) =>
  api<BuiltDeck>(`/api/decks/${deckId}/grow`, { method: 'POST', body: JSON.stringify(body) })

/** Update a deck's own rules (e.g. hide readings for this deck). */
export const updateDeck = (deckId: string, body: { name?: string; settings?: DeckSettings }) =>
  api<{ deck: Deck; settings?: DeckSettings }>(`/api/decks/${deckId}`, {
    method: 'PATCH',
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
  api<{ instance: Instance; action: { id: string; skillId: string; xp: number } | null }>(
    '/api/practice/next',
    { method: 'POST', body: JSON.stringify(body) },
  )

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
