import type { AlignItem, WordFeedback } from '@tutor/core'
import { levenshtein, normalize } from '../exercises/grading'

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const PUNCT = /^[\p{P}\p{S}]$/u

/** CJK: one token per character. Others: whitespace words. */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const part of text.trim().split(/\s+/)) {
    if (!part) continue
    if (CJK.test(part)) {
      for (const ch of part) if (!PUNCT.test(ch)) tokens.push(ch)
    } else {
      tokens.push(part.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''))
    }
  }
  return tokens.filter(Boolean)
}

export function syllableCount(token: string): number {
  if (CJK.test(token)) return token.length
  const runs = token.toLowerCase().match(/[aeiouy]+/g)
  return Math.max(1, runs ? runs.length : 1)
}

function multisetDiff(a: string[], b: string[]): string[] {
  const pool = [...b]
  const out: string[] = []
  for (const x of a) {
    const i = pool.indexOf(x)
    if (i >= 0) pool.splice(i, 1)
    else out.push(x)
  }
  return out
}

export interface WordTiming {
  text: string
  start: number
  end: number
  duration: number
  syllables: number
  /** syllables per second */
  rate: number
  /** timing looks off (too fast / clipped) */
  flagged: boolean
}

export interface Pause {
  after: string
  seconds: number
}

export interface AssessFeatures {
  expected: string
  transcript: string
  /** character error rate 0..1 */
  cer: number
  missing: string[]
  extra: string[]
  words: WordTiming[]
  pauses: Pause[]
  speechRate: number
  truncated: boolean
  duration: number
  /** 0..100 deterministic score (no LLM) */
  score: number
  correct: boolean
}

export interface AssessInput {
  expected: string
  transcript: string
  items: AlignItem[]
  duration: number
}

/** Turns the ASR + aligner output into explainable, deterministic features. */
export function computeFeatures(input: AssessInput): AssessFeatures {
  const expectedTokens = tokenize(input.expected)
  const transcriptTokens = tokenize(input.transcript)

  const normExpected = normalize(input.expected)
  const normTranscript = normalize(input.transcript)
  const denom = Math.max(1, normExpected.length)
  const cer = Math.min(1, levenshtein(normExpected, normTranscript) / denom)

  const missing = multisetDiff(expectedTokens, transcriptTokens)
  const extra = multisetDiff(transcriptTokens, expectedTokens)

  const words: WordTiming[] = input.items.map((it) => {
    const duration = Math.max(0.01, it.end - it.start)
    const syllables = syllableCount(it.text)
    const rate = syllables / duration
    // a CJK syllable below ~0.07s or above ~1s reads as unnatural (loose: fast
    // TTS and quick native speech shouldn't be flagged)
    const flagged = rate > 14 || rate < 1.0
    return { text: it.text, start: it.start, end: it.end, duration, syllables, rate, flagged }
  })

  const pauses: Pause[] = []
  for (let i = 1; i < input.items.length; i++) {
    const prev = input.items[i - 1]!
    const cur = input.items[i]!
    const gap = cur.start - prev.end
    if (gap > 0.4) pauses.push({ after: prev.text, seconds: Number(gap.toFixed(2)) })
  }

  const totalSyllables = expectedTokens.reduce((n, t) => n + syllableCount(t), 0)
  const speechRate = input.duration > 0 ? totalSyllables / input.duration : 0

  const lastEnd = input.items.length ? input.items[input.items.length - 1]!.end : 0
  const truncated =
    input.items.length < expectedTokens.length ||
    (input.duration - lastEnd > 0.5 && missing.length > 0)

  const coverage =
    expectedTokens.length > 0 ? (expectedTokens.length - missing.length) / expectedTokens.length : 1
  const accuracy = 1 - cer
  let score = Math.round(100 * (0.55 * accuracy + 0.45 * coverage))
  if (truncated) score = Math.max(0, score - 5)

  return {
    expected: input.expected,
    transcript: input.transcript,
    cer,
    missing,
    extra,
    words,
    pauses,
    speechRate,
    truncated,
    duration: input.duration,
    score,
    correct: score >= 70 && missing.length === 0,
  }
}

/** Deterministic per-word feedback (used when there is no LLM judge). */
export function deterministicWords(f: AssessFeatures): WordFeedback[] {
  const missingSet = new Set(f.missing)
  const timingByText = new Map(f.words.map((w) => [w.text, w]))
  return tokenize(f.expected).map((token) => {
    if (missingSet.has(token)) return { text: token, ok: false, tip: "we didn't hear this" }
    const t = timingByText.get(token)
    if (t?.flagged) return { text: token, ok: true, tip: 'sounded rushed' }
    return { text: token, ok: true }
  })
}

export function summarize(f: AssessFeatures): string {
  if (f.missing.length > 0) {
    return `You missed ${f.missing.join('、')}. They heard “${f.transcript}”.`
  }
  if (f.score >= 90) return 'Clear and accurate — nice work.'
  if (f.score >= 70) return 'Close enough, keep the rhythm steady.'
  return `Try again, aiming for “${f.expected}”.`
}
