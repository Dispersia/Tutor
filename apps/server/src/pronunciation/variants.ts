/**
 * Accent tolerance for Mandarin pronunciation grading (docs/DESIGN.md §9.4).
 *
 * The Chinese decks are Traditional characters + Zhuyin — the **Taiwan** standard
 * — so the grader must accept the Taiwan accent. Two families of realisations are
 * collapsed here:
 *
 *   initials   ㄓ → ㄗ   ㄔ → ㄘ   ㄕ → ㄙ   (retroflex → alveolar)
 *              ㄋ → ㄌ                       (n → l: 你 heard as 里)
 *              ㄈ → ㄏ                       (f → h: 飯 heard as 漢)
 *   finals     ㄥ → ㄣ                       (-eng/-ing → -en/-in: 星 heard as 心)
 *                                            (-ong/-iong keep their ㄥ)
 *
 * A learner who says 是 as “sì” is not making a mistake; they are speaking a
 * perfectly standard accent. The old grader compared characters literally, so
 * Whisper transcribing 是 as 四 (the same syllable under the merger) looked like
 * a missing word and scored 0.
 *
 * We fold both sides to the same key before comparing, so only *real* errors
 * survive. Tones are kept, so a wrong tone is still an error.
 */

import { mandarinZhuyin } from '../deck/mandarin'

/** Initial → the sound it merges with in Taiwan Mandarin. */
const MERGED_INITIALS: Record<string, string> = {
  'ㄓ': 'ㄗ',
  'ㄔ': 'ㄘ',
  'ㄕ': 'ㄙ',
  'ㄋ': 'ㄌ',
  'ㄈ': 'ㄏ',
}

const LEAD_TONE = '˙' // neutral tone is written *before* the syllable
const TAIL_TONES = ['ˊ', 'ˇ', 'ˋ'] // 1st tone carries no mark

/** Folds one Zhuyin syllable's initial and final to their Taiwan variants. */
function foldSyllable(syllable: string): string {
  let lead = ''
  let body = syllable
  if (body.startsWith(LEAD_TONE)) {
    lead = LEAD_TONE
    body = body.slice(1)
  }
  let tail = ''
  const last = body.slice(-1)
  if (TAIL_TONES.includes(last)) {
    tail = last
    body = body.slice(0, -1)
  }

  const head = body[0]
  const merged = head ? MERGED_INITIALS[head] : undefined
  if (merged) body = merged + body.slice(1)

  // -eng/-ing merge with -en/-in, but -ong/-iong do not merge with -un.
  if (body.endsWith('ㄥ')) {
    const stem = body.slice(0, -1)
    if (!stem.endsWith('ㄨ') && !stem.endsWith('ㄩ')) body = stem + 'ㄣ'
  }

  return lead + body + tail
}

/** Folds every syllable of a Zhuyin reading to its accent-equivalent form. */
export function foldZhuyin(zhuyin: string): string {
  return zhuyin.split(/\s+/).map(foldSyllable).join(' ')
}

/** The accent-folded reading of one character, or `undefined` if unknown. */
export function charSound(ch: string): string | undefined {
  const zhuyin = mandarinZhuyin(ch)
  return zhuyin ? foldZhuyin(zhuyin) : undefined
}

/**
 * True when two characters differ only by an accepted Taiwan-accent merger
 * (是/四, 你/里, 星/心, 飯/漢, …). Characters the dictionary does not know fall
 * back to a literal comparison, so this never makes an unknown pair “sound alike”.
 */
export function soundAlike(a: string, b: string): boolean {
  if (a === b) return true
  const key = charSound(a)
  return key !== undefined && key === charSound(b)
}
