/** Multiple choice: pick the meaning from seen distractors. */

import type { ExerciseDef } from '@tutor/core'
import { displayReading, furiganaFor, readingsShown, shuffle } from '../shared'

// --- multiple choice ---------------------------------------------------------

export const multipleChoice: ExerciseDef<string> = {
  id: 'multiple_choice',
  title: 'Pick the right answer',
  modality: 'text',
  supports: (card) => card.back.length <= 12,
  // Only meaningful when there is at least one other *seen* word to confuse it
  // with (see `otherBacks`): a one-option question is not a choice.
  available: (ctx) => ctx.distractors.length >= 1,
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
