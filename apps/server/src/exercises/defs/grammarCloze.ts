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
    const answer = payloadString(ctx.card, 'answer') ?? ctx.card.back
    const choices = choiceList(ctx.card.payload?.options, answer)
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

function choiceList(options: unknown, answer: string): string[] {
  const distractors = Array.isArray(options)
    ? options.filter((o): o is string => typeof o === 'string' && o.length > 0)
    : []
  if (!distractors.length) return []
  return [...new Set([answer, ...distractors])]
}
