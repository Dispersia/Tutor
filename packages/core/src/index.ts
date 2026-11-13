/** Shared domain contracts for tutor. No runtime deps — pure types + a registry. */

export type Modality = 'chat' | 'voice' | 'text' | 'mixed'
export type CardType = 'vocab' | 'phrase' | 'grammar' | 'kanji' | 'character'
/** BCP-47-ish language tag: 'en', 'zh', 'ja', ... */
export type Lang = string

export interface Card {
  id: string
  type: CardType
  sourceLang: Lang
  targetLang: Lang
  /** native side */
  front: string
  /** target-language side */
  back: string
  /** pinyin / romaji / kana */
  readings?: Record<string, string>
  tags: string[]
  /** type-specific extras, zod-validated per CardType (Phase 4) */
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
  /** OpenRouter model id per role — user-selectable in the app (§10.1) */
  roles: Record<LlmRole, string>
  voiceMode: 'preset' | 'design'
  /** preferred voice per language */
  voices: Record<Lang, string>
  /** speech gateway idle shutdown, ms (§8) */
  idleTimeoutMs: number
}

export type LlmRole = 'conversation' | 'judge' | 'generator' | 'translator'

export interface ExerciseContext {
  card?: Card
  learner: Learner
  sessionId?: string
  config: TutorConfig
}

export interface GradeResult {
  /** 0..100 */
  score: number
  correct: boolean
  feedback?: string
  detail?: Record<string, unknown>
}

/**
 * The extensibility contract (§11.2). Backend resolves `id -> generate/grade`;
 * the Svelte frontend maps `id -> component`. Adding an exercise touches only a
 * new file plus one registry line.
 */
export interface ExerciseDef<Instance = unknown, Answer = unknown> {
  id: string
  title: string
  modality: Modality
  supports(card: Card | undefined, learner: Learner): boolean
  generate(ctx: ExerciseContext): Promise<Instance>
  grade(ctx: ExerciseContext, instance: Instance, answer: Answer): Promise<GradeResult>
  xp(result: GradeResult, instance: Instance): number
}

export class ExerciseRegistry {
  #defs = new Map<string, ExerciseDef>()

  register(def: ExerciseDef): this {
    if (this.#defs.has(def.id)) throw new Error(`duplicate exercise id: ${def.id}`)
    this.#defs.set(def.id, def)
    return this
  }

  get(id: string): ExerciseDef | undefined {
    return this.#defs.get(id)
  }

  list(): ExerciseDef[] {
    return [...this.#defs.values()]
  }

  forCard(card: Card | undefined, learner: Learner): ExerciseDef[] {
    return this.list().filter((d) => d.supports(card, learner))
  }
}
