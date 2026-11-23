import { kanjiumReadings } from '../deck/kanjium'
import { mandarinSentenceZhuyin } from '../deck/mandarin'
import { levenshtein } from '../exercises/grading'
import { lettersAndDigits as plain } from '../text/normalize'

export interface Spoken {
  text: string
  language: string
  kana?: string
}

const SENTENCE_TOLERANCE = 0.15
const SENTENCE_MIN_CHARS = 6

function hiragana(text: string): string {
  return plain(text).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

const isKana = (text: string): boolean => /^[぀-ヿー]+$/.test(text)

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

function sameZhuyin(want: string, got: string): boolean {
  const a = mandarinSentenceZhuyin(want)
  return a !== undefined && want.length === got.length && a === mandarinSentenceZhuyin(got)
}

function sameKana(expected: Spoken, want: string, got: string): boolean {
  const wanted = new Set(readingsOf(want))
  if (expected.kana) wanted.add(hiragana(expected.kana))
  return readingsOf(got).some((r) => wanted.has(r))
}

function readingsOf(word: string): string[] {
  if (isKana(word)) return [hiragana(word)]
  return kanjiumReadings(word).map(hiragana)
}
