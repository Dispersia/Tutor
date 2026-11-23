export interface FuriganaSegment {
  base: string
  ruby?: string
}

const KANJI = /[\u4e00-\u9fff]/
const KANA = /[\u3040-\u309f\u30a0-\u30ff\u30fc]/

export function furiganaSegments(word: string, reading: string): FuriganaSegment[] {
  if (!word) return []
  if (!reading || !KANJI.test(word)) return [{ base: word }]
  const pre = sharedPrefix(word, reading)
  const suf = sharedSuffix(word, reading, pre)
  const segments = middleSegments(word, reading, pre, suf)
  return segments.length ? segments : [{ base: word }]
}

function sharedPrefix(word: string, reading: string): number {
  let pre = 0
  while (
    pre < word.length &&
    pre < reading.length &&
    KANA.test(word[pre]!) &&
    word[pre] === reading[pre]
  ) {
    pre++
  }
  return pre
}

function sharedSuffix(word: string, reading: string, pre: number): number {
  let suf = 0
  const tail = (s: string, i: number) => s[s.length - 1 - i]
  while (
    suf < word.length - pre &&
    suf < reading.length - pre &&
    KANA.test(tail(word, suf)!) &&
    tail(word, suf) === tail(reading, suf)
  ) {
    suf++
  }
  return suf
}

function middleSegments(
  word: string,
  reading: string,
  pre: number,
  suf: number,
): FuriganaSegment[] {
  const segments: FuriganaSegment[] = []
  if (pre > 0) segments.push({ base: word.slice(0, pre) })
  const midBase = word.slice(pre, word.length - suf)
  const midRuby = reading.slice(pre, reading.length - suf)
  if (midBase) {
    segments.push(
      midRuby && midRuby !== midBase ? { base: midBase, ruby: midRuby } : { base: midBase },
    )
  }
  if (suf > 0) segments.push({ base: word.slice(word.length - suf) })
  return segments
}
