import type { Card, PitchContour, PitchLevel, TemplateKind } from '@tutor/core'

export type { Card, PitchContour, PitchLevel }

export interface PublicUser {
  id: string
  username: string | null
  handle: string
  role: string
  nativeLang: string
  level: string | null
  createdAt: number
}

export interface ChatSession {
  id: string
  kind: string
  lang: string | null
  title: string | null
  startedAt: number
}

export interface Message {
  id: string
  sessionId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  text: string
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  costUsd: number | null
  createdAt: number
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number
  promptPricePerM: number
  completionPricePerM: number
  outputModalities: string[]
}

export type Role = 'conversation' | 'judge' | 'generator' | 'translator'

export type Roles = Record<Role, string>

export interface StudyPrefs {
  showZhuyin: boolean
  showFurigana: boolean
  disabledExercises: string[]
  newPerDay: number
  maxReviewsPerDay: number
  learningSteps: number[]
  autoReinforce: boolean
  activeDeckId?: string | null
}

export interface ExerciseInfo {
  id: string
  title: string
  modality: string
  needsAudio?: boolean
  disabled?: boolean
  template?: TemplateKind
}

export type ModKind = 'yield' | 'double' | 'xp' | 'global_xp' | 'damage' | 'drop' | 'hp' | 'coins'

export interface SpeechStatus {
  running: boolean
  ready: boolean
  models: string[]
  url: string
  idleForMs: number
  idleTimeoutMs: number
}
