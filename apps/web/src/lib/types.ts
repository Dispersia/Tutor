export interface PublicUser {
  id: string
  username: string | null
  handle: string
  role: string
  nativeLang: string
  targetLang: string | null
  level: string | null
  createdAt: number
}

export interface ChatSession {
  id: string
  kind: string
  lang: string | null
  title: string | null
  startedAt: number
  endedAt: number | null
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

export type TemplateKind = 'vocab' | 'spoken' | 'listening' | 'grammar' | 'sentence'

export interface TemplateField {
  path: string
  label: string
  kind: string
  required: boolean
  description: string
}

export interface CardTemplate {
  kind: TemplateKind
  title: string
  summary: string
  modality: string
  fields: TemplateField[]
  exercises: string[]
}

export type PitchLevel = 'H' | 'L'

export interface PitchContour {
  levels: PitchLevel[]
  drop?: number | null
  syllables?: string[]
}

export interface CardMetadata {
  pitch?: PitchContour
  [key: string]: unknown
}

export interface Card {
  id: string
  deckId: string | null
  type: string
  sourceLang: string
  targetLang: string
  front: string
  back: string
  readings: Record<string, string>
  tags: string[]
  payload: Record<string, unknown>
  metadata: CardMetadata
  origin: string
  createdAt: number
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
