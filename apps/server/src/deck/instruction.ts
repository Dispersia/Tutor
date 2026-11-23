/** Deck instruction parsing: the language rules a free-text prompt asks for. */

import type { CharacterVariant } from '../frequency/source'

/**
 * Words per planner call. Small enough that a batch (one vocab card per word
 * plus the interleaved sentence/grammar cards) stays inside the model's output
 * budget, large enough that a 1500-word import is not 1500 calls. A batch that
 * still comes back truncated is retried smaller — see {@link fillDeck}.
 */
export const PLAN_CHUNK = 20

/** A deck never asks for more words than the importer will even read. */
export const MAX_DECK_WORDS = 5000

export const DEFAULT_COUNT = 20

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/** Reads the character variant / reading script a free-text instruction asks for. */
export function parseInstruction(
  instruction: string,
  targetLang: string,
): { variant?: CharacterVariant; readingScript?: string; pitchAccent?: boolean } {
  const s = instruction.toLowerCase()
  const isChinese = targetLang === 'zh' || targetLang === 'yue'
  const isJapanese = targetLang === 'ja'

  // The deck's language wins over wording borrowed from another deck's prompt:
  // a remembered Chinese prompt must never force Zhuyin on a Japanese deck.
  let variant: CharacterVariant | undefined
  if (isChinese) {
    if (/traditional|繁體|繁体|zh_tw/.test(s)) variant = 'traditional'
    else if (/simplified|简体|簡體|zh_cn/.test(s)) variant = 'simplified'
    else if (targetLang === 'zh') variant = 'traditional' // the app's default
  }

  let readingScript: string | undefined
  if (isChinese) {
    if (/zhuyin|注音|bopomofo|ㄅㄆㄇ/.test(s)) readingScript = 'zhuyin'
    else if (/pinyin|拼音/.test(s)) readingScript = 'pinyin'
    else readingScript = 'zhuyin'
  } else if (isJapanese) {
    readingScript = /romaji|rōmaji/.test(s) ? 'romaji' : 'kana'
  }

  // Pitch-accent metadata is language-specific but opt-in: only ask the
  // generator when the instruction does (Japanese pitch accent, tone contours).
  const pitchAccent = /pitch|accent|アクセント|音調|音调|高低|聲調|声调|tone contour|tones?/.test(s)

  return { variant, readingScript, pitchAccent }
}
