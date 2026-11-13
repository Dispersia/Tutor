/** Shared domain contracts for tutor. No runtime deps (except the registry). */

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

export interface ExerciseContext {
  card: Card
  learner: Learner
  /** distractors for choice exercises (same target language) */
  distractors: string[]
  /** optional LLM helper, injected by the server (absent when no key is set) */
  judge?: (prompt: string, schema: object) => Promise<unknown>
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
  /** can this exercise be generated for this card? */
  supports(card: Card, learner: Learner): boolean
  generate(ctx: ExerciseContext): Promise<ExerciseInstance>
  grade(ctx: ExerciseContext, instance: ExerciseInstance, answer: Answer): Promise<GradeResult>
  xp(result: GradeResult, instance: ExerciseInstance): number
}

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
