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

export interface Roles extends Record<Role, string> {}

/** Per-user study preferences: reading display + which exercise kinds are offered. */
export interface StudyPrefs {
  showZhuyin: boolean
  showFurigana: boolean
  disabledExercises: string[]
  /** New cards to introduce per UTC day (0 = unlimited). */
  newPerDay: number
  /** Graded reviews allowed per UTC day (0 = unlimited). */
  maxReviewsPerDay: number
  /** Learning steps in minutes; a new card repeats once per step. */
  learningSteps: number[]
  /** Grow the deck automatically when a word keeps lapsing. */
  autoReinforce: boolean
  /** The deck the member studies everywhere (null = free practice across decks). */
  activeDeckId?: string | null
}

export interface ExerciseInfo {
  id: string
  title: string
  modality: string
  needsAudio?: boolean
  /** The card template this exercise belongs to (vocab, spoken, …). */
  template?: TemplateKind
}

export type TemplateKind = 'vocab' | 'spoken' | 'listening' | 'grammar' | 'sentence'

export interface TemplateField {
  /** Dotted path on the card: `back`, `readings.kana`, `payload.tokens`. */
  path: string
  label: string
  kind: string
  required: boolean
  description: string
}

/** A reusable, language-agnostic practice card template (see @tutor/core). */
export interface CardTemplate {
  kind: TemplateKind
  title: string
  summary: string
  modality: string
  fields: TemplateField[]
  exercises: string[]
}

/** One step of a pitch contour. */
export type PitchLevel = 'H' | 'L'

/**
 * A language-agnostic pitch contour (Japanese pitch accent, tone contours): one
 * level per syllable/mora. `drop` is the accent nucleus counted from 1 — the
 * mora after which the pitch falls (`0` = no in-word drop).
 */
export interface PitchContour {
  levels: PitchLevel[]
  drop?: number | null
  /** The syllable/mora texts the levels describe (kana); defaults to 1:1 chars. */
  syllables?: string[]
}

/** Language-specific annotations attached to a card (see @tutor/core). */
export interface CardMetadata {
  /** Pitch contour of the card's word (Japanese pitch accent, tones, …). */
  pitch?: PitchContour
  /** Any other annotation, keyed by convention (`radical`, `strokeOrder`, …). */
  [key: string]: unknown
}

/** A stored card, as the decks API returns it. */
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
