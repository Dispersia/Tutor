/**
 * Clip grading: does a recorded clip say the card's text, and nothing else?
 *
 * The speech model is unreliable on short text: it can append a sentence to a
 * single word, emit noise instead of the word, or read a Japanese word as
 * Chinese. So every clip is transcribed by the recogniser and kept only when the
 * transcript says what the card says (docs/DESIGN.md §9.2). The recogniser
 * checks the *words*; it cannot hear a wrong pitch or accent.
 */

import { kanjiumReadings } from '../deck/kanjium'
import { mandarinSentenceZhuyin } from '../deck/mandarin'
import { levenshtein } from '../exercises/grading'

/** What a clip is supposed to say. */
export interface Spoken {
  text: string
  language: string
  /** The card's kana reading, when it has one (Japanese). */
  kana?: string
}

/** How far a sentence's transcript may differ (share of its characters). */
const SENTENCE_TOLERANCE = 0.15
/** Text at least this long (after stripping) is graded as a sentence. */
const SENTENCE_MIN_CHARS = 6

/** Letters and digits only, lower-cased: what was said, not how it was written. */
function plain(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** Katakana folded to hiragana, so キ and き compare equal. */
function hiragana(text: string): string {
  return plain(text).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

const isKana = (text: string): boolean => /^[぀-ヿー]+$/.test(text)

/**
 * True when the transcript says the expected text and nothing more.
 *
 * A single word must match exactly, or sound identical: the recogniser picks
 * one spelling for a sound, so 他 may come back as 她 and 橋 as はし. A sentence
 * may differ by a few characters, which forgives a recogniser slip but not an
 * extra clause.
 */
export function saysExactly(expected: Spoken, transcript: string): boolean {
  const want = plain(expected.text)
  const got = plain(transcript)
  if (!want || !got) return false
  if (want === got || soundsTheSame(expected, want, got)) return true
  if (want.length < SENTENCE_MIN_CHARS) return false
  return levenshtein(want, got) / want.length <= SENTENCE_TOLERANCE
}

function soundsTheSame(expected: Spoken, want: string, got: string): boolean {
  if (expected.language === 'ja') return sameKana(expected, want, got)
  if (expected.language === 'zh') return sameZhuyin(want, got)
  return false
}

/** Mandarin homophones (他 / 她 / 它) are one sound: compare the readings. */
function sameZhuyin(want: string, got: string): boolean {
  const a = mandarinSentenceZhuyin(want)
  return a !== undefined && want.length === got.length && a === mandarinSentenceZhuyin(got)
}

/** Japanese: the transcript and the card share a kana reading. */
function sameKana(expected: Spoken, want: string, got: string): boolean {
  const wanted = new Set(readingsOf(want))
  if (expected.kana) wanted.add(hiragana(expected.kana))
  return readingsOf(got).some((r) => wanted.has(r))
}

/** Every kana reading a Japanese word can have: itself when kana, else the dictionary's. */
function readingsOf(word: string): string[] {
  if (isKana(word)) return [hiragana(word)]
  return kanjiumReadings(word).map(hiragana)
}
