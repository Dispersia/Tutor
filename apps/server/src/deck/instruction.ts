import type { CharacterVariant } from '../frequency/source'

export const PLAN_CHUNK = 20

export const MAX_DECK_WORDS = 5000

export const DEFAULT_COUNT = 20

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

export function parseInstruction(
  instruction: string,
  targetLang: string,
): { variant?: CharacterVariant; readingScript?: string; pitchAccent?: boolean } {
  const s = instruction.toLowerCase()
  const isChinese = targetLang === 'zh' || targetLang === 'yue'
  const isJapanese = targetLang === 'ja'
  return {
    variant: variantOf(s, targetLang, isChinese),
    readingScript: readingScriptOf(s, isChinese, isJapanese),
    pitchAccent: PITCH_REQUEST.test(s),
  }
}

const PITCH_REQUEST =
  /\b(?:pitch|accents?|tone contours?|tones)\b|アクセント|音調|音调|高低|聲調|声调/

const TRADITIONAL = 'traditional|繁體|繁体|zh_tw'
const SIMPLIFIED = 'simplified|简体|簡體|zh_cn'

const NEGATION = String.raw`(?:\b(?:not|no|never|avoid|without)|n['’]t|不要|不用|別用|别用)\s*(?:\b(?:use|using|in|the|any)\s+)*`

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
  const traditional = stance(s, TRADITIONAL)
  const simplified = stance(s, SIMPLIFIED)
  if (traditional === 'wanted') return 'traditional'
  if (simplified === 'wanted') return 'simplified'
  if (simplified === 'refused' && traditional !== 'refused') return 'traditional'
  if (traditional === 'refused' && simplified !== 'refused') return 'simplified'
  return targetLang === 'zh' ? 'traditional' : undefined
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
