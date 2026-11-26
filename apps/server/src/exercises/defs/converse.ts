import type { ExerciseContext, ExerciseDef, GradeResult } from '@tutor/core'
import { bareText as bare } from '../../text/normalize'
import { isUtterance } from '../payload'
import { label, wordView } from '../shared'

interface JudgeOut {
  score?: number
  correct?: boolean
  wordCorrect?: boolean
  feedback?: string
}

export const converse: ExerciseDef<string> = {
  id: 'converse',
  title: 'Use it in conversation',
  modality: 'mixed',
  needsSpeech: true,
  supports: (card) => !isUtterance(card),
  available: conversable,
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
    if (target && bare(text) === target) return wordAloneResult(ctx.card.back)
    if (ctx.judge) {
      const judged = await judgeResult(ctx, text)
      if (judged) return judged
    }
    return fallbackResult(ctx.card.back, text, target)
  },
  xp: (r) => (r.correct ? 5 + (r.score >= 90 ? 5 : 0) : 1),
}

const MIN_CONVERSE_KNOWN = 5

function conversable(ctx: ExerciseContext): boolean {
  if (hasMetSentence(ctx)) return true
  const known = new Set(ctx.known ?? [])
  const words = Object.keys(ctx.readings ?? {})
  return words.filter((word) => known.has(word)).length >= MIN_CONVERSE_KNOWN
}

function hasMetSentence(ctx: ExerciseContext): boolean {
  const met = new Set([...(ctx.known ?? []), ...(ctx.seen ?? [])])
  return (ctx.utterances ?? []).some((sentence) => met.has(sentence))
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

const CONVERSE_SCHEMA = {
  type: 'object',
  properties: {
    wordCorrect: { type: 'boolean' },
    score: { type: 'number' },
    correct: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: ['wordCorrect', 'score', 'correct', 'feedback'],
  additionalProperties: false,
}

async function judgeResult(ctx: ExerciseContext, text: string): Promise<GradeResult | undefined> {
  const out = (await ctx.judge!(prompt(ctx, text), CONVERSE_SCHEMA)) as JudgeOut | undefined
  if (!out || typeof out.score !== 'number') return undefined
  const target = bare(ctx.card.back)
  const used = out.wordCorrect ?? out.correct ?? out.score >= 70
  const correct = used && target !== '' && bare(text).includes(target)
  return {
    score: correct ? Math.max(out.score, 75) : out.score,
    correct,
    expected: ctx.card.back,
    feedback: out.feedback,
  }
}

function fallbackResult(back: string, text: string, target: string): GradeResult {
  const hasTarget = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)
  const usedWord = target ? bare(text).includes(target) : false
  const feedback = usedWord
    ? 'Nice — you used the word in a sentence.'
    : hasTarget
      ? `Try to work “${back}” into your sentence.`
      : 'Try writing a sentence in the target language.'
  return { score: usedWord ? 90 : hasTarget ? 55 : 30, correct: usedWord, expected: back, feedback }
}

const USE_RUBRIC = [
  'Judge the word, not the sentence — but judge the word in the sentence it was put in.',
  'wordCorrect = true when the word is there and carries its own meaning, so the sentence says something the word really belongs to.',
  'wordCorrect = false when the word is missing, stands alone, is only echoed without meaning, or sits where another word is needed — when the sentence only makes sense once the word is swapped for a different one.',
  'correct: set it to wordCorrect. Mistakes elsewhere in the sentence (grammar, particles, spelling, word order) never make it incorrect.',
  'score: 90 to 100 when the word is correct and the sentence is natural, 75 to 89 when the word is correct but the sentence has mistakes, under 50 when the word is not correct.',
  'In the feedback, praise the word briefly when it is correct, and add anything wrong with the rest of the sentence as a note.',
].join('\n')

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
