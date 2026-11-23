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
  return {
    // The deck's language wins over wording borrowed from another deck's prompt:
    // a remembered Chinese prompt must never force Zhuyin on a Japanese deck.
    variant: variantOf(s, targetLang, isChinese),
    readingScript: readingScriptOf(s, isChinese, isJapanese),
    // Pitch-accent metadata is language-specific but opt-in: only ask the
    // generator when the instruction does.
    pitchAccent: /pitch|accent|アクセント|音調|音调|高低|聲調|声调|tone contour|tones?/.test(s),
  }
}

function variantOf(
  s: string,
  targetLang: string,
  isChinese: boolean,
): CharacterVariant | undefined {
  if (!isChinese) return undefined
  if (/traditional|繁體|繁体|zh_tw/.test(s)) return 'traditional'
  if (/simplified|简体|簡體|zh_cn/.test(s)) return 'simplified'
  return targetLang === 'zh' ? 'traditional' : undefined // the app's default
}

function readingScriptOf(s: string, isChinese: boolean, isJapanese: boolean): string | undefined {
  if (isChinese) {
    if (/zhuyin|注音|bopomofo|ㄅㄆㄇ/.test(s)) return 'zhuyin'
    if (/pinyin|拼音/.test(s)) return 'pinyin'
    return 'zhuyin'
  }
  if (isJapanese) return /romaji|rōmaji/.test(s) ? 'romaji' : 'kana'
  return undefined
}
