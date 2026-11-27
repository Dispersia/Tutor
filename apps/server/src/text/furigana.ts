export interface FuriganaSegment {
  base: string
  ruby?: string
}

interface Cursor {
  wi: number
  ri: number
}

const KANJI = /[\u4e00-\u9fff]/
const KANA = /[\u3040-\u309f\u30a0-\u30ff\u30fc]/

export type ReadingLookup = (word: string) => string | undefined

export function furiganaWords(
  text: string,
  words: readonly string[],
  readingOf: ReadingLookup,
): FuriganaSegment[] {
  const segments: FuriganaSegment[] = []
  let at = 0
  for (const word of words) {
    if (!word) continue
    const index = text.indexOf(word, at)
    if (index < 0) continue
    if (index > at) segments.push({ base: text.slice(at, index) })
    segments.push(...furiganaSegments(word, readingOf(word) ?? ''))
    at = index + word.length
  }
  if (at < text.length) segments.push({ base: text.slice(at) })
  return segments
}

export function furiganaSegments(word: string, reading: string): FuriganaSegment[] {
  if (!word) return []
  if (!reading || !KANJI.test(word)) return [{ base: word }]
  const segments: FuriganaSegment[] = []
  const at: Cursor = { wi: 0, ri: 0 }
  while (at.wi < word.length) {
    const kanjiEnd = kanjiRunEnd(word, at.wi)
    if (kanjiEnd > at.wi) segments.push(takeKanji(word, reading, at, kanjiEnd))
    else segments.push(takeKana(word, reading, at))
  }
  return segments
}

function takeKanji(word: string, reading: string, at: Cursor, kanjiEnd: number): FuriganaSegment {
  const end = kanjiEnd === word.length ? reading.length : anchorAt(word, kanjiEnd, reading, at.ri)
  const base = word.slice(at.wi, kanjiEnd)
  const ruby = reading.slice(at.ri, end)
  at.ri = Math.max(at.ri, end)
  at.wi = kanjiEnd
  return ruby && ruby !== base ? { base, ruby } : { base }
}

function takeKana(word: string, reading: string, at: Cursor): FuriganaSegment {
  const kanaEnd = kanaRunEnd(word, at.wi)
  const base = word.slice(at.wi, kanaEnd)
  at.ri = advanceReading(reading, base, at.ri)
  at.wi = kanaEnd
  return { base }
}

function kanjiRunEnd(word: string, from: number): number {
  let i = from
  while (i < word.length && KANJI.test(word[i]!)) i++
  return i
}

function kanaRunEnd(word: string, from: number): number {
  let i = from
  while (i < word.length && !KANJI.test(word[i]!)) i++
  return i
}

function leadingKana(word: string, from: number): string {
  let i = from
  while (i < word.length && !KANJI.test(word[i]!) && KANA.test(word[i]!)) i++
  return word.slice(from, i)
}

function anchorAt(word: string, from: number, reading: string, ri: number): number {
  const anchor = leadingKana(word, from)
  if (!anchor) return reading.length
  const at = reading.indexOf(anchor, ri)
  return at < 0 ? reading.length : at
}

function advanceReading(reading: string, base: string, ri: number): number {
  let i = ri
  for (const ch of base) {
    if (KANA.test(ch) && reading[i] === ch) i++
  }
  return i
}
