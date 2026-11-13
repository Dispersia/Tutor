import { api } from './api'

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
  detail?: Record<string, unknown>
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
  levelXp: number
  streak: number
  dailyGoal: number
}

export const listDecks = () => api<{ decks: Deck[] }>('/api/decks')
export const listExercises = () =>
  api<{ exercises: { id: string; title: string; modality: string }[] }>('/api/exercises')
export const getStats = () => api<Stats>('/api/stats')

export const nextExercise = (body: { deckId?: string; exerciseId?: string }) =>
  api<{ instance: Instance }>('/api/practice/next', { method: 'POST', body: JSON.stringify(body) })

export const gradeExercise = (body: {
  exerciseId: string
  cardId: string
  answer: unknown
  latencyMs?: number
}) =>
  api<{ result: Grade; stats: { xp: number; level: number } }>('/api/practice/grade', {
    method: 'POST',
    body: JSON.stringify(body),
  })

/** Recorded-audio grading (pronunciation) — multipart to /api/practice/speak. */
export const gradeSpeak = (form: FormData) =>
  api<{ result: Grade; stats: { xp: number; level: number } }>('/api/practice/speak', {
    method: 'POST',
    body: form,
  })

export interface WordFeedback {
  text: string
  ok: boolean
  tip?: string
}
