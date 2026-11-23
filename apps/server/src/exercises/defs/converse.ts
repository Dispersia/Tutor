/** Free conversation turn: use the word in a sentence. */

import type { ExerciseDef, GradeResult } from '@tutor/core'
import { bare, isUtterance } from '../payload'
import { JUDGE_SCHEMA } from '../schemas'
import { label, wordView } from '../shared'

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
        `The learner is practising ${label(ctx.card.targetLang)}. They must write or say a full sentence that *uses* the word “${ctx.card.back}” (${ctx.card.front}). Judge only whether the word is used correctly for the sentence — its meaning fits the sentence — NOT whether the sentence is grammatical. Set correct=true whenever the learner makes a genuine attempt to use the word with its intended meaning, even if the sentence has grammar, word-order, spelling or particle mistakes; correct those mistakes briefly in the feedback instead of failing the card. Set correct=false only when the word is missing or clearly does not fit the sentence's meaning (the wrong word for that sentence). Repeating the word alone is not a sentence and must score low. The learner wrote/said: “${text}”. Grade the attempt (0-100) and give a short feedback. Only suggest a "tip" when the learner can still improve: never repeat, quote or lightly extend the learner's own sentence as the suggested version — it must not be the sentence they already wrote. If their sentence is already correct and natural, praise it and stop; do not invent a longer sentence, and do not tell them to use a sentence they just used. Write the feedback in the learner's native language (${label(ctx.learner.nativeLang)}), never in ${label(ctx.card.targetLang)}; only the word and any target-language example stay in ${label(ctx.card.targetLang)}.`,
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
    // The card is right when the word is worked into the sentence — grammar is
    // corrected in the feedback, never a reason to fail (see the judge above).
    const score = usedWord ? 90 : hasTarget ? 55 : 30
    return {
      score,
      correct: usedWord,
      expected: ctx.card.back,
      feedback: usedWord
        ? 'Nice — you used the word in a sentence.'
        : hasTarget
          ? `Try to work “${ctx.card.back}” into your sentence.`
          : 'Try writing a sentence in the target language.',
    }
  },
  xp: (r) => (r.correct ? 5 + (r.score >= 90 ? 5 : 0) : 1),
}
