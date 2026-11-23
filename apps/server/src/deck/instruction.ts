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
    pitchAccent: PITCH_REQUEST.test(s),
  }
}

/**
 * Whole words only: "milestone" and "a polite tone" are not a request for pitch
 * metadata, while "pitch accent", "with tones" and "tone contours" are.
 */
const PITCH_REQUEST =
  /\b(?:pitch|accents?|tone contours?|tones)\b|アクセント|音調|音调|高低|聲調|声调/

const TRADITIONAL = 'traditional|繁體|繁体|zh_tw'
const SIMPLIFIED = 'simplified|简体|簡體|zh_cn'

/** "not traditional", "no simplified", "don't use traditional", "不要繁體" … */
const NEGATION = String.raw`(?:\b(?:not|no|never|avoid|without)|n['’]t|不要|不用|別用|别用)\s*(?:\b(?:use|using|in|the|any)\s+)*`

/** Whether the prompt asks for a variant, rules it out, or does not mention it. */
function stance(s: string, names: string): 'wanted' | 'refused' | undefined {
  if (new RegExp(`${NEGATION}(?:${names})`).test(s)) return 'refused'
  return new RegExp(names).test(s) ? 'wanted' : undefined
}

function variantOf(
  s: string,
  targetLang: string,
  isChinese: boolean,
): CharacterVariant | undefined {
  if (!isChinese) return undefined
  // "Simplified characters please, not traditional" names both: the one that is
  // ruled out must not win just because it is tested first.
  const traditional = stance(s, TRADITIONAL)
  const simplified = stance(s, SIMPLIFIED)
  if (traditional === 'wanted') return 'traditional'
  if (simplified === 'wanted') return 'simplified'
  if (simplified === 'refused' && traditional !== 'refused') return 'traditional'
  if (traditional === 'refused' && simplified !== 'refused') return 'simplified'
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
