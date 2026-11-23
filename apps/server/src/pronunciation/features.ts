import type { AlignItem, WordFeedback } from '@tutor/core'
import { levenshtein, normalize } from '../exercises/grading'
import { charSound, soundAlike } from './variants'

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

function multisetDiff(a: string[], b: string[], eq: (x: string, y: string) => boolean): string[] {
  const pool = [...b]
  const out: string[] = []
  for (const x of a) {
    const i = pool.findIndex((y) => eq(x, y))
    if (i >= 0) pool.splice(i, 1)
    else out.push(x)
  }
  return out
}

/** Mandarin decks are Taiwan-standard, so sh/s (and friends) are not errors. */
const accentAware = (lang: string | undefined) => lang === 'zh'

/**
 * Normalised-comparable form of a text. For Mandarin each character is folded to
 * its accent-equivalent Zhuyin so that a Taiwan-accent rendering of 是 (heard as
 * 四) compares equal to the expected text; other languages use the plain
 * normalised characters.
 */
function foldForCompare(text: string, lang: string | undefined): string {
  const base = normalize(text)
  if (!accentAware(lang)) return base
  let out = ''
  for (const ch of base) out += charSound(ch) ?? ch
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
  /** Target language; enables Mandarin accent tolerance when `zh`. */
  lang?: string
}

/** Turns the ASR + aligner output into explainable, deterministic features. */
export function computeFeatures(input: AssessInput): AssessFeatures {
  const tokensEqual = accentAware(input.lang) ? soundAlike : (a: string, b: string) => a === b
  const expectedTokens = tokenize(input.expected)
  const transcriptTokens = tokenize(input.transcript)
  const cmp = compareTokens(expectedTokens, transcriptTokens, input, tokensEqual)
  const totalSyllables = expectedTokens.reduce((n, t) => n + syllableCount(t), 0)
  const truncated = isTruncated(input, expectedTokens, cmp.missing)
  return featureResult({
    input,
    ...cmp,
    words: wordTimings(input.items),
    pauses: pausesOf(input.items),
    speechRate: input.duration > 0 ? totalSyllables / input.duration : 0,
    truncated,
    score: scoreOf(cmp.cer, expectedTokens, cmp.missing, truncated),
  })
}

interface FeatureParts extends Compare {
  input: AssessInput
  words: WordTiming[]
  pauses: Pause[]
  speechRate: number
  truncated: boolean
  score: number
}

function featureResult(p: FeatureParts): AssessFeatures {
  return {
    expected: p.input.expected,
    transcript: p.input.transcript,
    cer: p.cer,
    missing: p.missing,
    extra: p.extra,
    words: p.words,
    pauses: p.pauses,
    speechRate: p.speechRate,
    truncated: p.truncated,
    duration: p.input.duration,
    score: p.score,
    correct: p.score >= 70 && p.missing.length === 0,
  }
}

interface Compare {
  cer: number
  missing: string[]
  extra: string[]
}

function compareTokens(
  expectedTokens: string[],
  transcriptTokens: string[],
  input: AssessInput,
  tokensEqual: (a: string, b: string) => boolean,
): Compare {
  return {
    cer: charErrorRate(input.expected, input.transcript, input.lang),
    missing: multisetDiff(expectedTokens, transcriptTokens, tokensEqual),
    extra: multisetDiff(transcriptTokens, expectedTokens, (x, y) => tokensEqual(y, x)),
  }
}

/** Character error rate over the accent-folded forms the two texts compare on. */
function charErrorRate(expected: string, transcript: string, lang: string | undefined): number {
  const normExpected = foldForCompare(expected, lang)
  const normTranscript = foldForCompare(transcript, lang)
  return Math.min(1, levenshtein(normExpected, normTranscript) / Math.max(1, normExpected.length))
}

function wordTimings(items: AlignItem[]): WordTiming[] {
  return items.map((it) => {
    const duration = Math.max(0.01, it.end - it.start)
    const syllables = syllableCount(it.text)
    const rate = syllables / duration
    // a CJK syllable below ~0.07s or above ~1s reads as unnatural (loose: fast
    // TTS and quick native speech shouldn't be flagged)
    const flagged = rate > 14 || rate < 1.0
    return { text: it.text, start: it.start, end: it.end, duration, syllables, rate, flagged }
  })
}

/** Gaps over 0.4s between aligned words, as pauses the learner took. */
function pausesOf(items: AlignItem[]): Pause[] {
  const pauses: Pause[] = []
  for (let i = 1; i < items.length; i++) {
    const gap = items[i]!.start - items[i - 1]!.end
    if (gap > 0.4) pauses.push({ after: items[i - 1]!.text, seconds: Number(gap.toFixed(2)) })
  }
  return pauses
}

/** A clip is truncated when it aligned fewer words than expected, or cut short. */
function isTruncated(input: AssessInput, expectedTokens: string[], missing: string[]): boolean {
  const last = input.items[input.items.length - 1]
  return (
    input.items.length < expectedTokens.length ||
    (input.duration - (last?.end ?? 0) > 0.5 && missing.length > 0)
  )
}

function scoreOf(
  cer: number,
  expectedTokens: string[],
  missing: string[],
  truncated: boolean,
): number {
  const coverage =
    expectedTokens.length > 0 ? (expectedTokens.length - missing.length) / expectedTokens.length : 1
  const score = Math.round(100 * (0.55 * (1 - cer) + 0.45 * coverage))
  return truncated ? Math.max(0, score - 5) : score
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
