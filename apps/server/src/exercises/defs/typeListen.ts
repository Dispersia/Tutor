import type { ExerciseDef } from '@tutor/core'
import { feedbackFor, gradeText, homophoneAnswer } from '../grading'
import { isUtterance } from '../payload'
import { displayReading, readingsOf } from '../shared'

export const typeListen: ExerciseDef<string> = {
  id: 'type_listen',
  title: 'Listen and type',
  modality: 'voice',
  supports: (card) => isUtterance(card),
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
    const typed = String(answer ?? '')
    if (homophoneAnswer(ctx.card.back, typed, ctx.card.targetLang)) {
      return { score: 100, correct: true, expected: ctx.card.back }
    }
    const g = gradeText(ctx.card.back, readingsOf(ctx), typed)
    return {
      score: g.score,
      correct: g.correct,
      expected: ctx.card.back,
      feedback: feedbackFor(g.score, ctx.card.back),
    }
  },
  xp: (r) => (r.correct ? 12 + (r.score === 100 ? 5 : 0) : 1),
}
