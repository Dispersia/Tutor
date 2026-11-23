import type { ExerciseDef } from '@tutor/core'
import { feedbackFor, gradeText } from '../grading'
import { displayReading, readingsOf } from '../shared'

export const typeListen: ExerciseDef<string> = {
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
