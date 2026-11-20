import {
  ExerciseRegistry,
  pitchOf,
  templateForExercise,
  type Card,
  type ExerciseContext,
  type ExerciseDef,
  type ExerciseInstance,
  type GradeResult,
} from '@tutor/core'
import { feedbackFor, gradeText, similarity } from './grading'
import { computeFeatures, deterministicWords, summarize } from '../pronunciation/features'
import { buildSentence, canBuildSentence, SENTENCE_POS } from '../game/grammar'
import { LEXICON } from '../seed/frequency'
import { furiganaSegments } from '../seed/furigana'
import { pinyinToZhuyin } from '../seed/zhuyin'

const LANG_LABEL: Record<string, string> = {
  zh: 'Mandarin',
  yue: 'Cantonese',
  ja: 'Japanese',
  ko: 'Korean',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

const label = (lang: string) => LANG_LABEL[lang] ?? lang

const readingsOf = (ctx: ExerciseContext): string[] =>
  Object.values(ctx.card.readings).filter(Boolean)

/** Whether native readings should be shown (the learner can turn them off). */
const readingsShown = (ctx: ExerciseContext): boolean => ctx.showReadings !== false

/**
 * The reading a learner should see: Zhuyin for Chinese, kana (furigana) for
 * Japanese. Never Latin transliteration — a legacy pinyin value is converted.
 * Empty when the learner has hidden readings in their study preferences.
 */
const displayReading = (ctx: ExerciseContext): string => {
  if (!readingsShown(ctx)) return ''
  const r = ctx.card.readings
  if (ctx.card.targetLang === 'ja') return r.kana || ''
  if (ctx.card.targetLang === 'zh') return r.zhuyin || (r.pinyin ? pinyinToZhuyin(r.pinyin) : '')
  return Object.values(r).find(Boolean) ?? ''
}

/** Furigana ruby segments for a Japanese word (undefined for other languages). */
const furiganaFor = (lang: string, word: string, reading: string) =>
  lang === 'ja' ? furiganaSegments(word, reading) : undefined

/** The target word plus the reading the learner should see (Zhuyin / furigana). */
const wordView = (ctx: ExerciseContext) => ({
  word: ctx.card.back,
  reading: displayReading(ctx),
  readingLang: ctx.card.targetLang,
  furigana: readingsShown(ctx)
    ? furiganaFor(ctx.card.targetLang, ctx.card.back, displayReading(ctx))
    : undefined,
  // Pitch accent rides on the reading, so hiding readings hides it too.
  pitch: readingsShown(ctx) ? pitchOf(ctx.card.metadata) : undefined,
})

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    correct: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: ['score', 'correct', 'feedback'],
  additionalProperties: false,
}

// --- translate: native -> target ---------------------------------------------

const translateFrontToBack: ExerciseDef<string> = {
  id: 'translate.front_to_back',
  title: 'Translate to the target language',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `How do you say “${ctx.card.front}” in ${label(ctx.card.targetLang)}?`,
      // `answerLang` tells the client which language the learner types (hints the
      // keyboard/IME; see docs/DESIGN.md §14.2). Here the answer is the target word.
      data: { answerLang: ctx.card.targetLang },
    }
  },
  async grade(ctx, _instance, answer) {
    const g = gradeText(ctx.card.back, readingsOf(ctx), String(answer ?? ''))
    const reading = displayReading(ctx)
    return {
      score: g.score,
      correct: g.correct,
      expected: ctx.card.back,
      feedback: feedbackFor(g.score, `${ctx.card.back}${reading ? ` (${reading})` : ''}`),
    }
  },
  xp: (r) => (r.correct ? 10 + (r.score === 100 ? 5 : 0) : 1),
}

// --- translate: target -> native ---------------------------------------------

const translateBackToFront: ExerciseDef<string> = {
  id: 'translate.back_to_front',
  title: 'Translate to your language',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `What does this mean in ${label(ctx.card.sourceLang)}?`,
      // The answer is in the learner's language, not the target — so hint that.
      data: { ...wordView(ctx), answerLang: ctx.card.sourceLang },
    }
  },
  async grade(ctx, _instance, answer) {
    const g = gradeText(ctx.card.front, [], String(answer ?? ''))
    const correct =
      g.score >= 70 || normalizeLoose(String(answer ?? '')) === normalizeLoose(ctx.card.front)
    return {
      score: correct ? Math.max(g.score, 80) : g.score,
      correct,
      expected: ctx.card.front,
      feedback: correct ? undefined : `It means “${ctx.card.front}”.`,
    }
  },
  xp: (r) => (r.correct ? 10 + (r.score === 100 ? 5 : 0) : 1),
}

function normalizeLoose(s: string): string {
  return s.toLowerCase().replace(/[\s.,!?]+/g, '')
}

// --- multiple choice ---------------------------------------------------------

const multipleChoice: ExerciseDef<string> = {
  id: 'multiple_choice',
  title: 'Pick the right answer',
  modality: 'text',
  supports: (card) => card.back.length <= 12,
  async generate(ctx) {
    const choices = shuffle([ctx.card.back, ...ctx.distractors]).slice(0, 4)
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `Which one means “${ctx.card.front}”?`,
      data: {
        choices,
        choiceReadings: readingsShown(ctx) ? choices.map((c) => ctx.readings?.[c] ?? '') : [],
        choiceFurigana: readingsShown(ctx)
          ? choices.map((c) => furiganaFor(ctx.card.targetLang, c, ctx.readings?.[c] ?? ''))
          : [],
        reading: displayReading(ctx),
        readingLang: ctx.card.targetLang,
      },
    }
  },
  async grade(ctx, _instance, answer) {
    const correct = String(answer ?? '').trim() === ctx.card.back
    return {
      score: correct ? 100 : 0,
      correct,
      expected: ctx.card.back,
      feedback: correct ? undefined : `“${ctx.card.front}” is ${ctx.card.back}.`,
    }
  },
  xp: (r) => (r.correct ? 8 : 1),
}

// --- listen & type -----------------------------------------------------------

const typeListen: ExerciseDef<string> = {
  id: 'type_listen',
  title: 'Listen and type',
  modality: 'voice',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'voice',
      prompt: 'Listen, then type what you hear.',
      data: {
        audioText: ctx.card.back,
        language: ctx.card.targetLang,
        answerLang: ctx.card.targetLang,
        reading: displayReading(ctx),
        readingLang: ctx.card.targetLang,
      },
    }
  },
  async grade(ctx, _instance, answer) {
    const g = gradeText(ctx.card.back, readingsOf(ctx), String(answer ?? ''))
    return {
      score: g.score,
      correct: g.correct,
      expected: ctx.card.back,
      feedback: feedbackFor(g.score, ctx.card.back),
    }
  },
  xp: (r) => (r.correct ? 12 + (r.score === 100 ? 5 : 0) : 1),
}

// --- speak the word: pronunciation scoring (DESIGN §9.4) ----------------------

const PRON_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    correct: { type: 'boolean' },
    summary: { type: 'string' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          ok: { type: 'boolean' },
          tip: { type: 'string' },
        },
        required: ['text', 'ok', 'tip'],
        additionalProperties: false,
      },
    },
  },
  required: ['score', 'correct', 'summary', 'words'],
  additionalProperties: false,
}

const speakWord: ExerciseDef<string> = {
  id: 'speak_word',
  title: 'Say it out loud',
  modality: 'voice',
  needsAudio: true,
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'voice',
      prompt: `Say “${ctx.card.back}” out loud.`,
      data: {
        target: ctx.card.back,
        language: ctx.card.targetLang,
        ...wordView(ctx),
      },
    }
  },
  /** Text fallback (no audio): compare the transcript directly. */
  async grade(ctx, _instance, answer) {
    const transcript = String(answer ?? '').trim()
    if (!transcript) {
      return {
        score: 0,
        correct: false,
        expected: ctx.card.back,
        feedback: "Didn't hear anything.",
      }
    }
    const g = gradeText(ctx.card.back, readingsOf(ctx), transcript)
    const best = Math.max(g.score, Math.round(similarity(ctx.card.back, transcript) * 100))
    return {
      score: best,
      correct: best >= 70,
      expected: ctx.card.back,
      feedback: `You said “${transcript}”.`,
      detail: { transcript },
    }
  },

  /** Real pronunciation path: ASR + forced alignment + optional LLM judge. */
  async gradeAudio(ctx, instance, audio) {
    const expected = ctx.card.back
    if (!ctx.assess) return speakWord.grade!(ctx, instance, '')

    const a = await ctx.assess(audio, expected)
    if (a.noSpeech) {
      return {
        score: 0,
        correct: false,
        expected,
        feedback: "Didn't catch that — say it again, a little closer to the mic.",
        detail: { noSpeech: true },
      }
    }
    const f = computeFeatures({
      expected,
      transcript: a.transcript,
      items: a.items,
      duration: a.duration,
    })

    let score = f.score
    let correct = f.correct
    let words = deterministicWords(f)
    let summary = summarize(f)

    if (ctx.judge) {
      const timings = f.words.map((w) => `${w.text}:${w.duration.toFixed(2)}s`).join(' ')
      const out = (await ctx.judge(
        `Grade the pronunciation of ${label(ctx.card.targetLang)} text “${expected}”.
The learner said (ASR): “${a.transcript}”.
Missing tokens: ${f.missing.join('、') || 'none'}. Character error rate: ${f.cer.toFixed(2)}.
Word timings: ${timings}. Long pauses: ${f.pauses.map((p) => `${p.after}+${p.seconds}s`).join(', ') || 'none'}.
Length ${f.duration.toFixed(2)}s. Write the summary and each word tip in the learner's native language (${label(ctx.learner.nativeLang)}); only the target tokens stay in ${label(ctx.card.targetLang)}. Be encouraging; flag the specific tokens that need work.`,
        PRON_SCHEMA,
      )) as
        | {
            score?: number
            correct?: boolean
            summary?: string
            words?: { text: string; ok: boolean; tip: string }[]
          }
        | undefined
      if (out && typeof out.score === 'number') {
        score = out.score
        correct = out.correct ?? correct
        summary = out.summary ?? summary
        if (Array.isArray(out.words) && out.words.length) words = out.words
      }
    }

    return {
      score,
      correct,
      expected,
      feedback: summary,
      detail: {
        transcript: a.transcript,
        words,
        cer: Number(f.cer.toFixed(3)),
        missing: f.missing,
        rate: Number(f.speechRate.toFixed(2)),
        truncated: f.truncated,
      },
    }
  },

  xp: (r) => (r.correct ? 15 + (r.score >= 90 ? 5 : 0) : 1),
}

// --- free conversation turn --------------------------------------------------

/** Strip spaces, punctuation and symbols so “你好。” and “你好” compare equal. */
const bare = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

const converse: ExerciseDef<string> = {
  id: 'converse',
  title: 'Use it in conversation',
  modality: 'mixed',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'mixed',
      prompt: `Make a sentence in ${label(ctx.card.targetLang)} using “${ctx.card.back}”.`,
      data: {
        topic: ctx.card.back,
        language: ctx.card.targetLang,
        answerLang: ctx.card.targetLang,
        ...wordView(ctx),
      },
    }
  },
  async grade(ctx, _instance, answer): Promise<GradeResult> {
    const text = String(answer ?? '').trim()
    if (!text)
      return {
        score: 0,
        correct: false,
        feedback: 'Write a sentence that uses the word.',
      }
    const target = bare(ctx.card.back)
    // The word on its own is not a sentence: force the learner to build around it.
    if (target && bare(text) === target)
      return {
        score: 20,
        correct: false,
        expected: ctx.card.back,
        feedback: `Use “${ctx.card.back}” inside a sentence, not on its own.`,
      }
    if (ctx.judge) {
      const out = (await ctx.judge(
        `The learner is practising ${label(ctx.card.targetLang)}. They must write or say a full sentence that *uses* the word “${ctx.card.back}” (${ctx.card.front}); repeating the word alone is not a sentence and must score low. The learner wrote/said: “${text}”. Grade the attempt (0-100) and give one short tip.`,
        JUDGE_SCHEMA,
      )) as { score?: number; correct?: boolean; feedback?: string } | undefined
      if (out && typeof out.score === 'number') {
        return {
          score: out.score,
          correct: out.correct ?? out.score >= 70,
          expected: ctx.card.back,
          feedback: out.feedback,
        }
      }
    }
    const hasTarget = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)
    const usedWord = target ? bare(text).includes(target) : false
    const score = usedWord ? 90 : hasTarget ? 65 : 35
    return {
      score,
      correct: score >= 60,
      expected: ctx.card.back,
      feedback: usedWord
        ? 'Nice — you used the word in a sentence.'
        : hasTarget
          ? `Good try. Can you work “${ctx.card.back}” into a full sentence?`
          : 'Try writing a sentence in the target language.',
    }
  },
  xp: (r) => (r.correct ? 5 + (r.score >= 90 ? 5 : 0) : 1),
}

// --- sentence build: n+1 sentence from known words (DESIGN §13.7) -------------

/** Deterministic PRNG so the same card always yields the same sentence. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Normalises a built/typed sentence for comparison (ignore spaces + punctuation). */
function normalizeSentence(s: string): string {
  return s.replace(/[\s.,!?。，！？、；：；'"]/g, '').trim()
}

/** Ordered target-language tokens a sentence card carries in its payload. */
function payloadTokens(card: Card): string[] {
  const t = card.payload?.tokens
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** True when the card carries its own segmented sentence (works in any language). */
const hasPayloadSentence = (card: Card): boolean => payloadTokens(card).length >= 2

const sentenceBuild: ExerciseDef<unknown> = {
  id: 'sentence_build',
  title: 'Build the sentence',
  modality: 'text',
  // Language-agnostic: any card that carries `payload.tokens` is a sentence card.
  // Mandarin frequency cards are also supported through the hand-written grammar
  // engine, so the seeded path keeps working without payload tokens.
  supports: (card) => {
    if (hasPayloadSentence(card)) return true
    if (card.targetLang !== 'zh') return false
    const entry = LEXICON.get(card.back)
    return Boolean(entry && SENTENCE_POS.has(entry.pos))
  },
  available: (ctx) => {
    if (hasPayloadSentence(ctx.card)) return true
    const entry = LEXICON.get(ctx.card.back)
    if (!entry || !ctx.known) return false
    return canBuildSentence(entry, new Set(ctx.known))
  },
  async generate(ctx) {
    // Generic path: the sentence lives on the card, so it works for any language.
    const tokens = payloadTokens(ctx.card)
    if (tokens.length >= 2) {
      const payload = ctx.card.payload ?? {}
      const gloss =
        typeof payload.gloss === 'string' && payload.gloss ? payload.gloss : ctx.card.front
      const extra = Array.isArray(payload.distractors)
        ? (payload.distractors as unknown[]).filter((d): d is string => typeof d === 'string')
        : ctx.distractors
      const distractors = extra.filter((d) => d && !tokens.includes(d)).slice(0, 3)
      return {
        exerciseId: this.id,
        cardId: ctx.card.id,
        modality: 'text',
        prompt: `Build the sentence: “${gloss}”`,
        data: {
          tokens,
          bank: shuffle([...tokens, ...distractors]),
          gloss,
          // No readings anywhere here: the learner builds the sentence from the
          // meaning, so any reading on the tiles gives the answer away.
          target: ctx.card.back,
          answerLang: ctx.card.targetLang,
          // Only an explicit `newWord` is a hint. Falling back to `back` would
          // print the whole sentence — the answer — under the tiles.
          newWord: typeof payload.newWord === 'string' ? payload.newWord : undefined,
        },
      }
    }
    // Mandarin fallback: build an n+1 sentence from the known-word grammar engine.
    const entry = LEXICON.get(ctx.card.back)
    const known = new Set(ctx.known ?? [])
    const seed = hashSeed(`${ctx.card.id}:${[...known].sort().join(',')}`)
    const build = entry ? buildSentence(entry, known, seededRandom(seed)) : undefined
    // Fallback (should not happen: the route filters via `available`): build the
    // word on its own so the exercise is still usable and never crashes.
    const data = build ?? {
      tokens: [ctx.card.back],
      bank: [ctx.card.back],
      gloss: ctx.card.front,
      target: ctx.card.back,
    }
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `Build the sentence: “${data.gloss}”`,
      data: {
        tokens: data.tokens,
        bank: data.bank,
        gloss: data.gloss,
        target: data.target,
        answerLang: ctx.card.targetLang,
        newWord: entry?.word ?? ctx.card.back,
      },
    }
  },
  async grade(_ctx, instance, answer) {
    const tokens = (instance.data.tokens as string[] | undefined) ?? []
    const expected = tokens.join('')
    const built = Array.isArray(answer)
      ? (answer as string[]).join('')
      : typeof answer === 'string'
        ? answer
        : String((answer as { tokens?: string[] })?.tokens?.join('') ?? '')
    const correct = expected.length > 0 && normalizeSentence(built) === normalizeSentence(expected)
    return {
      score: correct ? 100 : 0,
      correct,
      expected,
      feedback: correct ? undefined : `The sentence is “${expected}”.`,
    }
  },
  xp: (r) => (r.correct ? 12 + (r.score === 100 ? 3 : 0) : 1),
}

// --- grammar: apply a rule to a pattern (any language) ------------------------

/** Reads a string field off a card's payload. */
const payloadString = (card: Card, key: string): string | undefined => {
  const v = card.payload?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Generic grammar template. The card carries the practice in its payload, so the
 * same exercise serves every language: `prompt` (defaults to `front`), `answer`
 * (defaults to `back`), optional `options` for a choice card, plus `rule` and
 * `explanation` shown around the answer. With no options it is free typing.
 */
const grammarCloze: ExerciseDef<string> = {
  id: 'grammar_cloze',
  title: 'Apply the rule',
  modality: 'text',
  // Gated on explicit grammar markers so a plain word card is never offered as
  // grammar: the card must carry an answer, a rule or options.
  supports: (card) => {
    const options = card.payload?.options
    return Boolean(
      payloadString(card, 'answer') ||
      payloadString(card, 'rule') ||
      (Array.isArray(options) && options.length > 0),
    )
  },
  async generate(ctx) {
    const options = ctx.card.payload?.options
    const choices = Array.isArray(options)
      ? options.filter((o): o is string => typeof o === 'string' && o.length > 0)
      : []
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: payloadString(ctx.card, 'prompt') ?? ctx.card.front,
      data: {
        options: choices.length ? shuffle(choices) : undefined,
        rule: payloadString(ctx.card, 'rule'),
        reading: displayReading(ctx),
        readingLang: ctx.card.targetLang,
        answerLang: ctx.card.targetLang,
      },
    }
  },
  async grade(ctx, _instance, answer) {
    const expected = payloadString(ctx.card, 'answer') ?? ctx.card.back
    const explanation = payloadString(ctx.card, 'explanation')
    const g = gradeText(expected, readingsOf(ctx), String(answer ?? ''))
    return {
      score: g.score,
      correct: g.correct,
      expected,
      feedback: g.correct ? explanation : feedbackFor(g.score, expected),
    }
  },
  xp: (r) => (r.correct ? 10 + (r.score === 100 ? 3 : 0) : 1),
}

// --- introduce: first exposure teaches, never quizzes (DESIGN §13.7) ----------

/** Registry id of the first-exposure "teach" step. */
export const INTRODUCE_ID = 'introduce'

/** A short n+1 example sentence for the new word, using only words already met. */
function exampleFor(
  ctx: ExerciseContext,
): { text: string; reading: string; gloss: string; target: string } | undefined {
  if (ctx.card.targetLang !== 'zh') return undefined
  const entry = LEXICON.get(ctx.card.back)
  if (!entry || !SENTENCE_POS.has(entry.pos)) return undefined
  // n+1: every other token must be a word the learner has already met.
  const known = new Set([...(ctx.seen ?? ctx.known ?? []), ctx.card.back])
  if (!canBuildSentence(entry, known)) return undefined
  const build = buildSentence(entry, known, seededRandom(hashSeed(ctx.card.id)))
  if (!build) return undefined
  const zhuyinOf = (t: string) => {
    const e = LEXICON.get(t)
    return e ? pinyinToZhuyin(e.pinyin) : ''
  }
  return {
    text: build.tokens.join(''),
    reading: readingsShown(ctx) ? build.tokens.map(zhuyinOf).filter(Boolean).join(' ') : '',
    gloss: build.gloss,
    target: build.target,
  }
}

/**
 * The first time a learner meets a card, this presents it — the word, its native
 * reading and its meaning, with an example — instead of quizzing something they
 * have not been shown. It is never part of the drill rotation (`pickNextExercise`
 * filters it out); the practice route forces it for a new, unintroduced card.
 */
const introduce: ExerciseDef<string> = {
  id: INTRODUCE_ID,
  title: 'Meet a new word',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `A new word: “${ctx.card.front}”`,
      data: {
        ...wordView(ctx),
        meaning: ctx.card.front,
        example: exampleFor(ctx),
      },
    }
  },
  async grade(ctx) {
    // Nothing to recall yet — the teach step always "passes" and never schedules.
    return { score: 100, correct: true, expected: ctx.card.back }
  },
  xp: () => 0,
}

/**
 * The registry. To add an exercise: create the def, `register` it here, and add a
 * matching Svelte component keyed by the same `id` — no core changes (DESIGN §11.2).
 */
export const registry = new ExerciseRegistry()
  .register(introduce)
  .register(translateFrontToBack)
  .register(translateBackToFront)
  .register(multipleChoice)
  .register(typeListen)
  .register(speakWord)
  .register(converse)
  .register(sentenceBuild)
  .register(grammarCloze)

export function exerciseCatalog() {
  return registry.list().map((d) => ({
    id: d.id,
    title: d.title,
    modality: d.modality,
    needsAudio: Boolean(d.needsAudio),
    /** The card template this exercise belongs to (vocab, spoken, …). */
    template: templateForExercise(d.id)?.kind,
  }))
}
