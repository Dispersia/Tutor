/** Shared domain contracts for tutor. No runtime deps (except the registry). */

import type { CardMetadata } from './metadata'

export type Modality = 'chat' | 'voice' | 'text' | 'mixed'
export type CardType = 'vocab' | 'phrase' | 'grammar' | 'kanji' | 'character'
/** BCP-47-ish language tag: 'en', 'zh', 'ja', ... */
export type Lang = string

export interface Card {
  id: string
  deckId: string | null
  type: CardType
  sourceLang: Lang
  targetLang: Lang
  /** native side */
  front: string
  /** target-language side */
  back: string
  /** pinyin / romaji / kana — alternative correct spellings */
  readings: Record<string, string>
  tags: string[]
  /** type-specific extras, versioned per CardType */
  payload: Record<string, unknown>
  /**
   * Language-specific annotations that don't fit the role-named content above
   * (Japanese pitch accent, tone contours, radicals, …). Language-agnostic
   * container; see `metadata.ts`. Never used for grading.
   */
  metadata: CardMetadata
  origin: 'curated' | 'llm' | 'manual'
  createdAt: number
}

export interface Learner {
  id: string
  nativeLang: Lang
  targetLang: Lang
  /** e.g. 'hsk1', 'n5' */
  level: string
}

export interface TutorConfig {
  roles: Record<LlmRole, string>
  voiceMode: 'preset' | 'design'
  voices: Record<Lang, string>
  idleTimeoutMs: number
}

export type LlmRole = 'conversation' | 'judge' | 'generator' | 'translator'

/** What a generated exercise instance looks like on the wire (JSON). */
export interface ExerciseInstance {
  exerciseId: string
  cardId: string
  modality: Modality
  /** short instruction shown to the learner */
  prompt: string
  /** exercise-specific data, read by the matching frontend component */
  data: Record<string, unknown>
}

export interface GradeResult {
  /** 0..100 */
  score: number
  correct: boolean
  /** what the answer should have been */
  expected?: string
  feedback?: string
  detail?: Record<string, unknown>
}

/** Per-word pronunciation feedback (DESIGN §9.4). */
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

/** Result of the speech gateway's one-shot ASR + alignment probe. */
export interface AssessResult {
  transcript: string
  items: AlignItem[]
  duration: number
  /** true when the clip held no audible speech (silent / too short to judge) */
  noSpeech?: boolean
}

export interface ExerciseContext {
  card: Card
  learner: Learner
  /** distractors for choice exercises (same target language) */
  distractors: string[]
  /**
   * display reading (Zhuyin for Chinese, kana for Japanese) keyed by the
   * target-language text — lets choice exercises annotate every option.
   */
  readings?: Record<string, string>
  /**
   * target-language words the learner already knows (learned + the current
   * card). Used by exercises that must build on prior knowledge (n+1), such as
   * `sentence_build`. Absent when the caller has no learner state (e.g. tests).
   */
  known?: string[]
  /**
   * target-language words the learner has *met* — introduced in the teach step or
   * reviewed — plus the current card. Looser than `known`: a first-exposure n+1
   * example may reuse anything the learner has seen, not only what has graduated.
   */
  seen?: string[]
  /**
   * Whether the learner wants native readings (Zhuyin / furigana) shown. When
   * false, exercises omit display readings from prompts, options and feedback —
   * grading still accepts the card's readings as correct answers. Defaults to
   * true when absent.
   */
  showReadings?: boolean
  /** optional LLM helper, injected by the server (absent when no key is set) */
  judge?: (prompt: string, schema: object) => Promise<unknown>
  /** optional speech assessor, injected by the server for audio grading */
  assess?: (audio: Uint8Array, expected: string) => Promise<AssessResult>
}

/**
 * The extensibility contract (§11.2). The backend resolves `id -> generate/grade`;
 * the frontend maps `id -> component`. Adding an exercise touches only a new file
 * plus one `registry.register(...)` line — nothing in the core changes.
 */
export interface ExerciseDef<Answer = unknown> {
  id: string
  title: string
  modality: Modality
  /** true for exercises that grade recorded audio (routed via /api/practice/speak) */
  needsAudio?: boolean
  /**
   * Temporarily switched off product-wide (not by the learner). The drill
   * rotation skips it and a caller that forces it is given an allowed kind
   * instead. Used for features that are built but not reliable yet — e.g. the
   * pronunciation card. Remove the flag to bring the exercise back.
   */
  temporarilyDisabled?: boolean
  /** can this exercise be generated for this card? */
  supports(card: Card, learner: Learner): boolean
  /**
   * Optional second gate that needs learner state (the `known` set, etc.).
   * `supports` is static; `available` may look at the full context. When it
   * returns false the exercise is skipped for this card.
   */
  available?(ctx: ExerciseContext): boolean
  generate(ctx: ExerciseContext): Promise<ExerciseInstance>
  grade(ctx: ExerciseContext, instance: ExerciseInstance, answer: Answer): Promise<GradeResult>
  /** audio grading path used when `needsAudio` is set */
  gradeAudio?(
    ctx: ExerciseContext,
    instance: ExerciseInstance,
    audio: Uint8Array,
  ): Promise<GradeResult>
  xp(result: GradeResult, instance: ExerciseInstance): number
}

export * from './templates'
export * from './metadata'

export class ExerciseRegistry {
  #defs = new Map<string, ExerciseDef<unknown>>()

  register<A>(def: ExerciseDef<A>): this {
    if (this.#defs.has(def.id)) throw new Error(`duplicate exercise id: ${def.id}`)
    this.#defs.set(def.id, def as unknown as ExerciseDef<unknown>)
    return this
  }

  get(id: string): ExerciseDef<unknown> | undefined {
    return this.#defs.get(id)
  }

  list(): ExerciseDef<unknown>[] {
    return [...this.#defs.values()]
  }

  /** Exercises that can be built for this card, in registration order. */
  forCard(card: Card, learner: Learner): ExerciseDef<unknown>[] {
    return this.list().filter((d) => d.supports(card, learner))
  }
}
