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

/** The judge prompt: only the word's use is judged, not the grammar. */
function prompt(ctx: ExerciseContext, text: string): string {
  const lang = label(ctx.card.targetLang)
  const native = label(ctx.learner.nativeLang)
  return `The learner is practising ${lang}. They must write or say a full sentence that *uses* the word “${ctx.card.back}” (${ctx.card.front}). Judge only whether the word is used correctly for the sentence — its meaning fits the sentence — NOT whether the sentence is grammatical. Set correct=true whenever the learner makes a genuine attempt to use the word with its intended meaning, even if the sentence has grammar, word-order, spelling or particle mistakes; correct those mistakes briefly in the feedback instead of failing the card. Set correct=false only when the word is missing or clearly does not fit the sentence's meaning (the wrong word for that sentence). Repeating the word alone is not a sentence and must score low. The learner wrote/said: “${text}”. Grade the attempt (0-100) and give a short feedback. Only suggest a "tip" when the learner can still improve: never repeat, quote or lightly extend the learner's own sentence as the suggested version — it must not be the sentence they already wrote. If their sentence is already correct and natural, praise it and stop; do not invent a longer sentence, and do not tell them to use a sentence they just used. Write the feedback in the learner's native language (${native}), never in ${lang}; only the word and any target-language example stay in ${lang}.`
}
