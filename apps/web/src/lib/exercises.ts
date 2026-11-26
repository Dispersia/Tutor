import { api } from './api'
import type { SkillOutcome } from './skills'
import type { Card } from './types'

export interface Instance {
  exerciseId: string
  cardId: string
  modality: string
  needsSpeech?: boolean
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
  answer?: string
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
  kind?: 'path' | 'custom'
  autoGrow?: boolean
  batchWords?: number
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
  reviews: number
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

export const createPathDeck = (body: { targetLang: string; sourceLang?: string; name?: string }) =>
  api<BuiltDeck>('/api/decks', {
    method: 'POST',
    body: JSON.stringify({ ...body, kind: 'path' }),
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

export interface CardIssue {
  cardId: string
  type: string
  front: string
  back: string
  reasons: string[]
  prune: string[]
  strip: string[]
}

export interface DeckAudit {
  checked: number
  issues: CardIssue[]
  applied?: { dropped: number; pruned: number }
}

export const auditDeck = (deckId: string, apply = false) =>
  api<DeckAudit>(`/api/decks/${deckId}/audit`, {
    method: 'POST',
    body: JSON.stringify({ apply }),
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

const GRADE_TIMEOUT_MS = 15_000

const gradeSignal = () => AbortSignal.timeout(GRADE_TIMEOUT_MS)

export function gradeError(e: unknown): string {
  if (e instanceof DOMException && e.name === 'TimeoutError')
    return 'Checking took too long (15s) — try again.'
  return (e as Error).message
}

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
  }>('/api/practice/grade', { method: 'POST', body: JSON.stringify(body), signal: gradeSignal() })

export const gradeSpeak = (form: FormData) =>
  api<{
    result: Grade
    skill: SkillOutcome | null
    srs?: SrsOutcome
    lessonCompleted?: boolean
    stats: Stats
  }>('/api/practice/speak', { method: 'POST', body: form, signal: gradeSignal() })

export interface WordFeedback {
  text: string
  ok: boolean
  tip?: string
}
