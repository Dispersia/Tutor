/**
 * Furigana splitting (docs/DESIGN.md §13.7).
 *
 * Japanese cards store the whole-word kana reading. To render real furigana we
 * need the ruby split: which kana belong to the kanji vs the okurigana. This is
 * derived by matching the shared kana prefix/suffix (お茶 → お + 茶[ちゃ],
 * 食べる → 食[た] + べる).
 */

export interface FuriganaSegment {
  base: string
  /** kana shown above the base (absent for plain okurigana / kana-only runs) */
  ruby?: string
}

const KANJI = /[\u4e00-\u9fff]/
const KANA = /[\u3040-\u309f\u30a0-\u30ff\u30fc]/

/** Splits `word` + whole-word `reading` into ruby segments. */
export function furiganaSegments(word: string, reading: string): FuriganaSegment[] {
  if (!word) return []
  if (!reading || !KANJI.test(word)) return [{ base: word }]

  let pre = 0
  while (
    pre < word.length &&
    pre < reading.length &&
    KANA.test(word[pre]!) &&
    word[pre] === reading[pre]
  ) {
    pre++
  }
  let suf = 0
  while (
    suf < word.length - pre &&
    suf < reading.length - pre &&
    KANA.test(word[word.length - 1 - suf]!) &&
    word[word.length - 1 - suf] === reading[reading.length - 1 - suf]
  ) {
    suf++
  }

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
  return segments.length ? segments : [{ base: word }]
}
