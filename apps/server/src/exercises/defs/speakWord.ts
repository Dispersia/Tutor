/** Speak the word: pronunciation scoring (DESIGN §9.4). */

import type {
  AssessResult,
  ExerciseContext,
  ExerciseDef,
  GradeResult,
  WordFeedback,
} from '@tutor/core'
import { computeFeatures, deterministicWords, summarize } from '../../pronunciation/features'
import { gradeText, similarity } from '../grading'
import { PRON_SCHEMA } from '../schemas'
import { gradingReading, label, readingsOf, wordView } from '../shared'

type Features = ReturnType<typeof computeFeatures>

/** The score a pronunciation attempt resolved to, before it is laid out. */
interface PronScore {
  score: number
  correct: boolean
  summary: string
  words: WordFeedback[]
}

/** What the LLM judge may return, every field optional. */
interface JudgeOut {
  score?: number
  correct?: boolean
  summary?: string
  words?: WordFeedback[]
}

export const speakWord: ExerciseDef<string> = {
  id: 'speak_word',
  title: 'Say it out loud',
  modality: 'voice',
  needsAudio: true,
  // Off for now: the pronunciation scoring is not reliable enough to drill yet.
  // Flip this back off (or remove the line) to bring the card back.
  temporarilyDisabled: true,
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
    if (a.noSpeech) return noSpeechResult(expected)
    const f = computeFeatures({
      expected,
      transcript: a.transcript,
      items: a.items,
      duration: a.duration,
      lang: ctx.card.targetLang,
    })
    const scored = await refine(ctx, expected, a, f)
    return audioResult(expected, a.transcript, f, scored)
  },

  xp: (r) => (r.correct ? 15 + (r.score >= 90 ? 5 : 0) : 1),
}

function noSpeechResult(expected: string): GradeResult {
  return {
    score: 0,
    correct: false,
    expected,
    feedback: "Didn't catch that — say it again, a little closer to the mic.",
    detail: { noSpeech: true },
  }
}

/** The deterministic features' score, upgraded by the judge when one is set. */
async function refine(
  ctx: ExerciseContext,
  expected: string,
  a: AssessResult,
  f: Features,
): Promise<PronScore> {
  const base = baseScore(f)
  if (!ctx.judge) return base
  const out = await askJudge(ctx, expected, a, f)
  if (!out || typeof out.score !== 'number') return base
  return {
    score: out.score,
    correct: out.correct ?? base.correct,
    summary: out.summary ?? base.summary,
    words: out.words?.length ? out.words : base.words,
  }
}

function baseScore(f: Features): PronScore {
  return {
    score: f.score,
    correct: f.correct,
    summary: summarize(f),
    words: deterministicWords(f),
  }
}

async function askJudge(
  ctx: ExerciseContext,
  expected: string,
  a: AssessResult,
  f: Features,
): Promise<JudgeOut | undefined> {
  return (await ctx.judge!(judgePrompt(ctx, expected, a, f), PRON_SCHEMA)) as JudgeOut | undefined
}

function audioResult(expected: string, transcript: string, f: Features, s: PronScore): GradeResult {
  return {
    score: s.score,
    correct: s.correct,
    expected,
    feedback: s.summary,
    detail: attemptDetail(transcript, f, s.words),
  }
}

function attemptDetail(transcript: string, f: Features, words: WordFeedback[]) {
  return {
    transcript,
    words,
    cer: Number(f.cer.toFixed(3)),
    missing: f.missing,
    rate: Number(f.speechRate.toFixed(2)),
    truncated: f.truncated,
  }
}

function judgePrompt(ctx: ExerciseContext, expected: string, a: AssessResult, f: Features): string {
  const reading = gradingReading(ctx)
  const readingLine = reading ? `The correct reading is ${reading}. ` : ''
  const timings = f.words.map((w) => `${w.text}:${w.duration.toFixed(2)}s`).join(' ')
  const pauses = f.pauses.map((p) => `${p.after}+${p.seconds}s`).join(', ') || 'none'
  const missing = f.missing.join('、') || 'none'
  return [
    `Grade the pronunciation of ${label(ctx.card.targetLang)} text “${expected}”. ${readingLine}The learner said (ASR): “${a.transcript}”.`,
    `Missing tokens: ${missing}. Character error rate: ${f.cer.toFixed(2)}.`,
    `Word timings: ${timings}. Long pauses: ${pauses}. Length ${f.duration.toFixed(2)}s.`,
    pronGuide(ctx),
    `Write the summary and every word tip in the learner's native language (${label(ctx.learner.nativeLang)}), never in ${label(ctx.card.targetLang)}.`,
  ].join('\n')
}

/** The pronunciation-grading rules the judge must follow, with its languages. */
function pronGuide(ctx: ExerciseContext): string {
  const target = label(ctx.card.targetLang)
  const native = label(ctx.learner.nativeLang)
  return [
    `Write the summary and each word tip in the learner's native language (${native}); only the target tokens stay in ${target}. Be encouraging; flag the specific tokens that need work.`,
    '',
    'How to grade pronunciation:',
    `- The reading above is authoritative: when you mention it, copy it exactly (it is Zhuyin / kana). Never write pinyin, and never describe a sound with a Latin-letter look-alike such as “shee”, “sh” or “see” — those misdescribe the sound and confuse the learner.`,
    `- The ASR transcript is only a guess and often mis-hears a short clip. The learner is practising a ${target} accent where this is standard; do not assume a syllable was wrong just because the transcript shows another word.`,
    `- If Mandarin: this is the Taiwan standard. A learner whose ㄓ/ㄔ/ㄕ come out as ㄗ/ㄘ/ㄙ (or the reverse) is speaking a correct accent — never mark that as an error.`,
    `- If the transcript is a different word entirely and nothing matches the expected text, say you could not hear it clearly and ask the learner to say it once more. Do not invent a detailed pronunciation diagnosis.`,
  ].join('\n')
}
