import { api } from './api'
import type { SkillOutcome } from './skills'
import type { Card } from './types'

export interface Instance {
  exerciseId: string
  cardId: string
  modality: string
  prompt: string
  data: Record<string, unknown>
}

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

export interface DeckSettings {
  showReadings?: boolean
  readingScript?: string
  variant?: 'traditional' | 'simplified'
  pitchAccent?: boolean
  disabledExercises?: string[]
  cursor?: number
  batchSize?: number
  instruction?: string
  building?: boolean
  buildTotal?: number
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

export interface BuiltDeck {
  deck: Deck
  cardCount: number
  source: string
  newWords: string[]
}

export interface ActivityDay {
  day: string
  xp: number
}

export interface Stats {
  xp: number
  level: number
  progress: number
  streak: number
  dailyGoal: number
  dailyXp: number
  goalPct: number
  todayActive: boolean
  activity?: { today: string; days: ActivityDay[] }
  quietUntil?: number
}

export const listDecks = () => api<{ decks: Deck[] }>('/api/decks')

export const createDeck = (body: {
  instruction: string
  targetLang?: string
  topic?: string
  count?: number
  name?: string
}) => api<BuiltDeck>('/api/decks', { method: 'POST', body: JSON.stringify(body) })

export interface AnkiInspection {
  name?: string
  fields: string[]
  sample: string[][]
  noteCount: number
  suggested: { wordField: number; readingField: number; meaningField: number }
  suggestedLang?: string
}

export const inspectDeck = (form: FormData) =>
  api<AnkiInspection>('/api/decks/inspect', { method: 'POST', body: form })

export const importDeck = (form: FormData) =>
  api<BuiltDeck & { words: number; fields: string[]; building?: boolean }>('/api/decks/import', {
    method: 'POST',
    body: form,
  })

export const growDeck = (
  deckId: string,
  body: { topic?: string; count?: number; all?: boolean } = {},
) => api<BuiltDeck>(`/api/decks/${deckId}/grow`, { method: 'POST', body: JSON.stringify(body) })

export const updateDeck = (deckId: string, body: { name?: string; settings?: DeckSettings }) =>
  api<{ deck: Deck; settings?: DeckSettings }>(`/api/decks/${deckId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

export const deleteDeck = (deckId: string) =>
  api<{ ok: boolean; deckId: string }>(`/api/decks/${deckId}`, { method: 'DELETE' })

export const backfillPitch = (deckId: string, opts: { force?: boolean } = {}) =>
  api<{ updated: number; total: number }>(`/api/decks/${deckId}/pitch`, {
    method: 'POST',
    ...(opts.force ? { body: JSON.stringify({ force: true }) } : {}),
  })

export const getDeckCards = (deckId: string) =>
  api<{ deck: Deck; cards: Card[] }>(`/api/decks/${deckId}/cards`)

export interface CardPatch {
  front?: string
  back?: string
  readings?: Record<string, string>
  metadata?: Record<string, unknown>
}

export const updateDeckCard = (deckId: string, cardId: string, patch: CardPatch) =>
  api<{ card: Card }>(`/api/decks/${deckId}/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

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

export const getStats = () => api<Stats>('/api/stats')

export const nextExercise = (body: {
  deckId?: string
  exerciseId?: string
  actionId?: string
  lessonId?: string
  choiceId?: string
}) =>
  api<{
    instance: Instance | null
    action: { id: string; skillId: string; xp: number } | null
    done?: boolean
    budget?: StudyBudget
    lessonId?: string
  }>('/api/practice/next', { method: 'POST', body: JSON.stringify(body) })

export const studyMore = () =>
  api<{ ok: boolean; budget: StudyBudget }>('/api/study/more', {
    method: 'POST',
    body: '{}',
  })

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
  choiceId?: string
}) =>
  api<{
    result: Grade
    skill: SkillOutcome | null
    srs?: SrsOutcome
    lessonCompleted?: boolean
    stats: Stats
  }>('/api/practice/grade', { method: 'POST', body: JSON.stringify(body) })

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
