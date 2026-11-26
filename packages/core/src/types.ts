import type { CardMetadata } from './metadata'

export type Modality = 'chat' | 'voice' | 'text' | 'mixed'
export type CardType = 'vocab' | 'phrase' | 'grammar' | 'kanji' | 'character'
export type Lang = string

export interface Card {
  id: string
  deckId: string | null
  type: CardType
  sourceLang: Lang
  targetLang: Lang
  front: string
  back: string
  readings: Record<string, string>
  tags: string[]
  payload: Record<string, unknown>
  metadata: CardMetadata
  origin: 'curated' | 'llm' | 'manual'
  createdAt: number
}

export interface Learner {
  id: string
  nativeLang: Lang
  targetLang: Lang
  level: string
}

export interface TutorConfig {
  roles: Record<LlmRole, string>
  voiceMode: 'preset' | 'design'
  voices: Record<Lang, string>
  idleTimeoutMs: number
}

export type LlmRole = 'conversation' | 'judge' | 'generator' | 'translator'

export interface ExerciseInstance {
  exerciseId: string
  cardId: string
  modality: Modality
  needsSpeech?: boolean
  prompt: string
  data: Record<string, unknown>
}

export interface GradeResult {
  score: number
  correct: boolean
  answer?: string
  expected?: string
  feedback?: string
  detail?: Record<string, unknown>
}

export interface WordFeedback {
  text: string
  ok: boolean
  tip?: string
}

export interface AlignItem {
  text: string
  start: number
  end: number
}

export interface AssessResult {
  transcript: string
  items: AlignItem[]
  duration: number
  noSpeech?: boolean
}

export interface ExerciseContext {
  card: Card
  learner: Learner
  distractors: string[]
  readings?: Record<string, string>
  known?: string[]
  seen?: string[]
  utterances?: string[]
  showReadings?: boolean
  judge?: (prompt: string, schema: object) => Promise<unknown>
  assess?: (audio: Uint8Array, expected: string) => Promise<AssessResult>
}

export interface ExerciseDef<Answer = unknown> {
  id: string
  title: string
  modality: Modality
  needsAudio?: boolean
  needsSpeech?: boolean
  temporarilyDisabled?: boolean
  supports(card: Card, learner: Learner): boolean
  available?(ctx: ExerciseContext): boolean
  generate(ctx: ExerciseContext): Promise<ExerciseInstance>
  grade(ctx: ExerciseContext, instance: ExerciseInstance, answer: Answer): Promise<GradeResult>
  gradeAudio?(
    ctx: ExerciseContext,
    instance: ExerciseInstance,
    audio: Uint8Array,
  ): Promise<GradeResult>
  xp(result: GradeResult, instance: ExerciseInstance): number
}
