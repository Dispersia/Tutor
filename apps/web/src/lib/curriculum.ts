import { api } from './api'

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
}

export interface CurriculumDeck {
  deckId: string
  name: string
  level: string
  targetLang: string
  cardCount: number
  learned: number
  due: number
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
}

export const getCurriculum = () => api<CurriculumResponse>('/api/curriculum')
export const getSrsStats = () => api<SrsStats>('/api/srs/stats')
