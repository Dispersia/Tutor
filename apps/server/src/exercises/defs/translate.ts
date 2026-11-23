/** Translation drills in both directions. */

import type { ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import { feedbackFor, gradeText, meaningAlternatives } from '../grading'
import { JUDGE_SCHEMA } from '../schemas'
import { displayReading, label, readingsOf, wordView } from '../shared'

// --- translate: native -> target ---------------------------------------------

export const translateFrontToBack: ExerciseDef<string> = {
  id: 'translate.front_to_back',
  title: 'Translate to the target language',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `How do you say “${ctx.card.front}” in ${label(ctx.card.targetLang)}?`,
      // `answerLang` tells the client which language the learner types (hints the
      // keyboard/IME; see docs/DESIGN.md §14.2). Here the answer is the target word.
      data: { answerLang: ctx.card.targetLang },
    }
  },
  async grade(ctx, _instance, answer) {
    const g = gradeText(ctx.card.back, readingsOf(ctx), String(answer ?? ''))
    const reading = displayReading(ctx)
    return {
      score: g.score,
      correct: g.correct,
      expected: ctx.card.back,
      feedback: feedbackFor(g.score, `${ctx.card.back}${reading ? ` (${reading})` : ''}`),
    }
  },
  xp: (r) => (r.correct ? 10 + (r.score === 100 ? 5 : 0) : 1),
}

// --- translate: target -> native ---------------------------------------------

export const translateBackToFront: ExerciseDef<string> = {
  id: 'translate.back_to_front',
  title: 'Translate to your language',
  modality: 'text',
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'text',
      prompt: `What does this mean in ${label(ctx.card.sourceLang)}?`,
      // The answer is in the learner's language, not the target — so hint that.
      data: { ...wordView(ctx), answerLang: ctx.card.sourceLang },
    }
  },
  async grade(ctx, _instance, answer) {
    const typed = String(answer ?? '')
    // A gloss can list several senses (“of / possessive particle / nominalizer”):
    // knowing any one of them is knowing the word.
    const alternatives = meaningAlternatives(ctx.card.front)
    const g = gradeText(ctx.card.front, alternatives, typed, { gloss: true })
    // Deterministic grading can't know every acceptable paraphrase, so an
    // unmatched answer goes to the LLM judge (when one is configured) before we
    // call it wrong — see DESIGN §11.3.
    if (g.score < 70 && typed.trim() && ctx.judge) {
      const judged = await judgeMeaning(ctx, typed)
      if (judged) return judged
    }
    const correct = g.score >= 70
    return {
      score: correct ? Math.max(g.score, 80) : g.score,
      correct,
      expected: ctx.card.front,
      feedback: correct ? undefined : `It means “${ctx.card.front}”.`,
    }
  },
  xp: (r) => (r.correct ? 10 + (r.score === 100 ? 5 : 0) : 1),
}

interface JudgeOut {
  score?: number
  correct?: boolean
  feedback?: string
}

/** The judge's verdict when it accepted the answer, else undefined. */
async function judgeMeaning(ctx: ExerciseContext, typed: string): Promise<GradeResult | undefined> {
  const out = (await ctx.judge!(meaningPrompt(ctx, typed), JUDGE_SCHEMA)) as JudgeOut | undefined
  if (!out?.correct) return undefined
  return {
    score: Math.max(out.score ?? 80, 80),
    correct: true,
    expected: ctx.card.front,
    feedback: out.feedback,
  }
}

/** Asks whether the typed answer is an acceptable meaning of the card's word. */
function meaningPrompt(ctx: ExerciseContext, typed: string): string {
  const reading = displayReading(ctx)
  const source = label(ctx.card.sourceLang)
  return [
    `Task: decide whether the learner knows what a ${label(ctx.card.targetLang)} word means.`,
    '',
    `Word: ${ctx.card.back}${reading ? ` (${reading})` : ''}`,
    `Accepted meanings in ${source}, separated by "/": ${ctx.card.front}`,
    `Learner's answer: ${typed}`,
    '',
    'correct = true when the answer matches any accepted meaning, or is a synonym or close paraphrase of one. Ignore typos, capital letters, articles and a leading "to".',
    'correct = false when it means something else or is too vague to show they know the word.',
    'score: 100 for an accepted meaning, 80 to 95 for a synonym or paraphrase, under 50 when wrong.',
    `feedback: when wrong, the meaning in one short ${source} sentence. When right, a few words at most.`,
  ].join('\n')
}

// --- multiple choice ---------------------------------------------------------
