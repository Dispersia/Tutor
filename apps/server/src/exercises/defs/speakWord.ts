/** Speak the word: pronunciation scoring (DESIGN §9.4). */

import type { ExerciseDef } from '@tutor/core'
import { computeFeatures, deterministicWords, summarize } from '../../pronunciation/features'
import { gradeText, similarity } from '../grading'
import { PRON_SCHEMA } from '../schemas'
import { gradingReading, label, readingsOf, wordView } from '../shared'

export const speakWord: ExerciseDef<string> = {
  id: 'speak_word',
  title: 'Say it out loud',
  modality: 'voice',
  needsAudio: true,
  // Off for now: the pronunciation scoring is not reliable enough to drill yet.
  // Flip this back off (or remove the line) to bring the card back.
  temporarilyDisabled: true,
  supports: () => true,
  async generate(ctx) {
    return {
      exerciseId: this.id,
      cardId: ctx.card.id,
      modality: 'voice',
      prompt: `Say “${ctx.card.back}” out loud.`,
      data: {
        target: ctx.card.back,
        language: ctx.card.targetLang,
        ...wordView(ctx),
      },
    }
  },
  /** Text fallback (no audio): compare the transcript directly. */
  async grade(ctx, _instance, answer) {
    const transcript = String(answer ?? '').trim()
    if (!transcript) {
      return {
        score: 0,
        correct: false,
        expected: ctx.card.back,
        feedback: "Didn't hear anything.",
      }
    }
    const g = gradeText(ctx.card.back, readingsOf(ctx), transcript)
    const best = Math.max(g.score, Math.round(similarity(ctx.card.back, transcript) * 100))
    return {
      score: best,
      correct: best >= 70,
      expected: ctx.card.back,
      feedback: `You said “${transcript}”.`,
      detail: { transcript },
    }
  },

  /** Real pronunciation path: ASR + forced alignment + optional LLM judge. */
  async gradeAudio(ctx, instance, audio) {
    const expected = ctx.card.back
    if (!ctx.assess) return speakWord.grade!(ctx, instance, '')

    const a = await ctx.assess(audio, expected)
    if (a.noSpeech) {
      return {
        score: 0,
        correct: false,
        expected,
        feedback: "Didn't catch that — say it again, a little closer to the mic.",
        detail: { noSpeech: true },
      }
    }
    const f = computeFeatures({
      expected,
      transcript: a.transcript,
      items: a.items,
      duration: a.duration,
      lang: ctx.card.targetLang,
    })

    let score = f.score
    let correct = f.correct
    let words = deterministicWords(f)
    let summary = summarize(f)

    if (ctx.judge) {
      const timings = f.words.map((w) => `${w.text}:${w.duration.toFixed(2)}s`).join(' ')
      const reading = gradingReading(ctx)
      const readingLine = reading ? `The correct reading is ${reading}. ` : ''
      const out = (await ctx.judge(
        `Grade the pronunciation of ${label(ctx.card.targetLang)} text “${expected}”. ${readingLine}The learner said (ASR): “${a.transcript}”.
Missing tokens: ${f.missing.join('、') || 'none'}. Character error rate: ${f.cer.toFixed(2)}.
Word timings: ${timings}. Long pauses: ${f.pauses.map((p) => `${p.after}+${p.seconds}s`).join(', ') || 'none'}.
Length ${f.duration.toFixed(2)}s. Write the summary and each word tip in the learner's native language (${label(ctx.learner.nativeLang)}); only the target tokens stay in ${label(ctx.card.targetLang)}. Be encouraging; flag the specific tokens that need work.

How to grade pronunciation:
- The reading above is authoritative: when you mention it, copy it exactly (it is Zhuyin / kana). Never write pinyin, and never describe a sound with a Latin-letter look-alike such as “shee”, “sh” or “see” — those misdescribe the sound and confuse the learner.
- The ASR transcript is only a guess and often mis-hears a short clip. The learner is practising a ${label(ctx.card.targetLang)} accent where this is standard; do not assume a syllable was wrong just because the transcript shows another word.
- If Mandarin: this is the Taiwan standard. A learner whose ㄓ/ㄔ/ㄕ come out as ㄗ/ㄘ/ㄙ (or the reverse) is speaking a correct accent — never mark that as an error.
- If the transcript is a different word entirely and nothing matches the expected text, say you could not hear it clearly and ask the learner to say it once more. Do not invent a detailed pronunciation diagnosis.
Write the summary and every word tip in the learner's native language (${label(ctx.learner.nativeLang)}), never in ${label(ctx.card.targetLang)}.`,
        PRON_SCHEMA,
      )) as
        | {
            score?: number
            correct?: boolean
            summary?: string
            words?: { text: string; ok: boolean; tip: string }[]
          }
        | undefined
      if (out && typeof out.score === 'number') {
        score = out.score
        correct = out.correct ?? correct
        summary = out.summary ?? summary
        if (Array.isArray(out.words) && out.words.length) words = out.words
      }
    }

    return {
      score,
      correct,
      expected,
      feedback: summary,
      detail: {
        transcript: a.transcript,
        words,
        cer: Number(f.cer.toFixed(3)),
        missing: f.missing,
        rate: Number(f.speechRate.toFixed(2)),
        truncated: f.truncated,
      },
    }
  },

  xp: (r) => (r.correct ? 15 + (r.score >= 90 ? 5 : 0) : 1),
}
