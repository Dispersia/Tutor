/** Free conversation turn: use the word in a sentence. */

import type { ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import { bare, isUtterance } from '../payload'
import { JUDGE_SCHEMA } from '../schemas'
import { label, wordView } from '../shared'

/** What the judge may return for a converse attempt, every field optional. */
interface JudgeOut {
  score?: number
  correct?: boolean
  feedback?: string
}

export const converse: ExerciseDef<string> = {
  id: 'converse',
  title: 'Use it in conversation',
  modality: 'mixed',
  // Single words only: "make a sentence using …" is meaningless for a card
  // whose target text is already a full sentence (DESIGN §11.3).
  supports: (card) => !isUtterance(card),
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
    if (!text) return emptyResult()
    const target = bare(ctx.card.back)
    // The word on its own is not a sentence: force the learner to build around it.
    if (target && bare(text) === target) return wordAloneResult(ctx.card.back)
    if (ctx.judge) {
      const judged = await judgeResult(ctx, text)
      if (judged) return judged
    }
    return fallbackResult(ctx.card.back, text, target)
  },
  xp: (r) => (r.correct ? 5 + (r.score >= 90 ? 5 : 0) : 1),
}

function emptyResult(): GradeResult {
  return { score: 0, correct: false, feedback: 'Write a sentence that uses the word.' }
}

function wordAloneResult(back: string): GradeResult {
  return {
    score: 20,
    correct: false,
    expected: back,
    feedback: `Use “${back}” inside a sentence, not on its own.`,
  }
}

/** The judge's verdict when it returned a usable score, else undefined. */
async function judgeResult(ctx: ExerciseContext, text: string): Promise<GradeResult | undefined> {
  const out = (await ctx.judge!(prompt(ctx, text), JUDGE_SCHEMA)) as JudgeOut | undefined
  if (!out || typeof out.score !== 'number') return undefined
  return {
    score: out.score,
    correct: out.correct ?? out.score >= 70,
    expected: ctx.card.back,
    feedback: out.feedback,
  }
}

/** Deterministic fallback: right once the word is worked into the sentence. */
function fallbackResult(back: string, text: string, target: string): GradeResult {
  const hasTarget = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)
  const usedWord = target ? bare(text).includes(target) : false
  // Grammar is corrected in the feedback, never a reason to fail (see the judge).
  const feedback = usedWord
    ? 'Nice — you used the word in a sentence.'
    : hasTarget
      ? `Try to work “${back}” into your sentence.`
      : 'Try writing a sentence in the target language.'
  return { score: usedWord ? 90 : hasTarget ? 55 : 30, correct: usedWord, expected: back, feedback }
}

/** What counts as using the word: its meaning, not the sentence's grammar. */
const USE_RUBRIC = [
  'Judge only whether the word is used with its meaning. Grammar, word order, particles and spelling do not decide the grade.',
  'correct = true: a real sentence in which the word carries its meaning, even if the sentence has other mistakes.',
  'correct = false: the word is missing, stands alone, or does not fit what the sentence says.',
  'score: 90 to 100 when correct and natural, 70 to 89 when correct with mistakes, under 50 when not correct.',
].join('\n')

/** The judge prompt: only the word's use is judged, not the grammar. */
function prompt(ctx: ExerciseContext, text: string): string {
  const lang = label(ctx.card.targetLang)
  const native = label(ctx.learner.nativeLang)
  return [
    `Task: the learner must use a ${lang} word in a sentence of their own.`,
    '',
    `Word: ${ctx.card.back} (${ctx.card.front})`,
    `Learner's sentence: ${text}`,
    '',
    USE_RUBRIC,
    '',
    `feedback, in ${native}, two short sentences at most:`,
    '- The sentence is natural: brief praise and nothing more.',
    `- The sentence has mistakes: give the corrected ${lang} sentence and say what changed.`,
    '- The word does not fit: say why in a few words.',
    "Never offer the learner's own sentence back as a suggestion, and never suggest a longer sentence than the task needs.",
  ].join('\n')
}
