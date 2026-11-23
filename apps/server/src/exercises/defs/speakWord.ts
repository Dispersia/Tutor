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

interface PronScore {
  score: number
  correct: boolean
  summary: string
  words: WordFeedback[]
}

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
  const timings = f.words.map((w) => `${w.text}:${w.duration.toFixed(2)}s`).join(' ')
  const pauses = f.pauses.map((p) => `${p.after}+${p.seconds}s`).join(', ') || 'none'
  return [
    `Task: give pronunciation feedback on a learner reading ${label(ctx.card.targetLang)} aloud.`,
    '',
    `Expected text: ${expected}${reading ? `\nCorrect reading: ${reading}` : ''}`,
    `What the speech recogniser heard: ${a.transcript}`,
    `Not heard: ${f.missing.join('、') || 'nothing'}. Character error rate: ${f.cer.toFixed(2)}.`,
    `Timing per word: ${timings}. Long pauses: ${pauses}. Total ${f.duration.toFixed(2)}s.`,
    '',
    pronGuide(ctx),
  ].join('\n')
}

function pronGuide(ctx: ExerciseContext): string {
  const native = label(ctx.learner.nativeLang)
  return [
    'How to read this evidence:',
    '- The recogniser only guesses, and often mishears a short clip. A different word in the transcript is not proof of a wrong sound: trust it only where it agrees with the missing words and the timing.',
    '- When nothing in the transcript matches the expected text, you cannot tell what was said. Say you could not hear it clearly and ask for one more try; do not diagnose a sound.',
    ctx.card.targetLang === 'zh' &&
      '- This is Taiwan Mandarin: ㄓ ㄔ ㄕ spoken as ㄗ ㄘ ㄙ (or the reverse) is a correct accent, not an error.',
    '',
    'What to return:',
    '- score 0 to 100, and correct = true when a listener would understand the whole text.',
    `- summary: one or two encouraging ${native} sentences naming the one thing to work on.`,
    `- words: one entry per word of the expected text, with ok and a short ${native} tip (an empty tip when ok).`,
    '- When you name a sound, copy it from the correct reading exactly. Never spell a sound in Latin letters ("shee", "sh").',
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
}
