import type { ExerciseDef } from '@tutor/core'
import { feedbackFor, gradeText } from '../grading'
import { payloadString } from '../payload'
import { displayReading, readingsOf, shuffle } from '../shared'

export const grammarCloze: ExerciseDef<string> = {
  id: 'grammar_cloze',
  title: 'Apply the rule',
  modality: 'text',
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
