import { api } from './api'
import type { StudyBudget } from './exercises'

export interface LessonDTO {
  id: string
  index: number
  title: string
  description: string
  level: string
  cards: number
  learned: number
  due: number
  complete: boolean
  newWord?: string
  reading?: string
}

export interface CurriculumDeck {
  deckId: string
  name: string
  level: string | null
  targetLang: string
  description?: string | null
  settings?: import('./exercises').DeckSettings
  cardCount: number
  learned: number
  due: number
  remaining?: number
  lessons: LessonDTO[]
}

export interface CurriculumResponse {
  decks: CurriculumDeck[]
}

export interface SrsStats {
  total: number
  learned: number
  due: number
  new: number
  budget: StudyBudget
}

export const getCurriculum = () => api<CurriculumResponse>('/api/curriculum')
export const getSrsStats = () => api<SrsStats>('/api/srs/stats')
