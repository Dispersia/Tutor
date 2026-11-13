import { api } from './api'
import type { SkillOutcome } from './skills'

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

export interface Deck {
  id: string
  name: string
  sourceLang: string
  targetLang: string
  level: string | null
  description: string | null
  cardCount: number
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
}

export const listDecks = () => api<{ decks: Deck[] }>('/api/decks')
export const listExercises = () =>
  api<{ exercises: { id: string; title: string; modality: string }[] }>('/api/exercises')
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
