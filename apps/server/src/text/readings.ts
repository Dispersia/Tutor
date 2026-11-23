/**
 * Card readings: which key of `card.readings` a reading is stored under, and
 * which one a learner is shown (docs/DESIGN.md §13.7).
 *
 * | language        | stored under                                             | shown             |
 * | --------------- | -------------------------------------------------------- | ----------------- |
 * | Japanese `ja`   | `kana`                                                   | `kana`            |
 * | Mandarin `zh`   | `zhuyin` (a Latin reading is converted); `pinyin` only   | `zhuyin`, else    |
 * |                 | when the deck's reading script is pinyin                 | `pinyin` → Zhuyin |
 * | Cantonese `yue` | `zhuyin` when written in a native script, `reading` when | first non-empty   |
 * |                 | romanised (jyutping); `pinyin` on a pinyin-script deck   |                   |
 * | anything else   | `reading`                                                | first non-empty   |
 *
 * Every writer goes through {@link storedReadings} and every reader through
 * {@link displayReading}, so the two sides cannot disagree about a key.
 */

import { pinyinToZhuyin } from './zhuyin'

export type ReadingKey = 'kana' | 'zhuyin' | 'pinyin' | 'reading'

const isChinese = (lang: string): boolean => lang === 'zh' || lang === 'yue'
const LATIN = /[a-zA-Z]/

/** The key of `card.readings` a reading belongs under. */
export function readingKey(targetLang: string, reading: string, script?: string): ReadingKey {
  if (targetLang === 'ja') return 'kana'
  if (!isChinese(targetLang)) return 'reading'
  if (script === 'pinyin') return 'pinyin'
  // Cantonese romanisation (jyutping) is not pinyin: the Mandarin converter
  // would mangle it, so it is kept as written under the generic key.
  return targetLang === 'yue' && LATIN.test(reading) ? 'reading' : 'zhuyin'
}

/** Every key {@link storedReadings} can write for a language. */
function readingKeysFor(targetLang: string): ReadingKey[] {
  if (targetLang === 'ja') return ['kana']
  return isChinese(targetLang) ? ['zhuyin', 'pinyin', 'reading'] : ['reading']
}

/** A reading on its way into `card.readings`. */
export interface ReadingSource {
  targetLang: string
  reading: string | undefined
  /** The deck's reading script (`zhuyin` | `pinyin` | `kana` | `romaji`). */
  script?: string
  /** Zhuyin to store when a Mandarin reading arrives in Latin letters and does not convert. */
  fallbackZhuyin?: () => string | undefined
}

/**
 * The `card.readings` entry for a reading — the one storage mapper. Empty when
 * there is no reading, or when a Mandarin deck that wants Zhuyin was handed
 * Latin letters that neither convert nor have a fallback: nothing is better
 * than a romanisation stored where Zhuyin belongs.
 */
export function storedReadings(src: ReadingSource): Record<string, string> {
  const { targetLang, reading } = src
  if (!reading) return {}
  const key = readingKey(targetLang, reading, src.script)
  if (key !== 'zhuyin' || !LATIN.test(reading)) return { [key]: reading }
  const zhuyin = zhuyinFromPinyin(reading) ?? src.fallbackZhuyin?.()
  return zhuyin ? { zhuyin } : {}
}

/**
 * A card's readings with its reading replaced: `undefined` leaves them alone,
 * an empty string clears the reading, and anything else is stored through
 * {@link storedReadings} — after the language's old keys are dropped, so a
 * reading that moves to another key never leaves the stale one behind.
 */
export function withReading(
  readings: Record<string, string>,
  src: ReadingSource,
): Record<string, string> {
  const next = { ...readings }
  if (src.reading === undefined) return next
  for (const key of readingKeysFor(src.targetLang)) delete next[key]
  return { ...next, ...storedReadings(src) }
}

/**
 * Pinyin → Zhuyin, or undefined when it does not convert cleanly. Punctuation
 * is dropped first ("Nǐ hǎo!"); whatever the converter still cannot read — tone
 * digits ("ni3"), mixed scripts, another romanisation — comes back with `?`
 * marks, and that is refused rather than stored.
 */
export function zhuyinFromPinyin(reading: string): string | undefined {
  const cleaned = reading.replace(/[^\p{L}\p{M}\p{N}\s'’]/gu, ' ')
  const zhuyin = pinyinToZhuyin(cleaned)
  return zhuyin && !zhuyin.includes('?') ? zhuyin : undefined
}

/**
 * The native reading of a card — the one display function: kana for Japanese,
 * Zhuyin for Mandarin (a stored pinyin value is converted, never shown), and
 * otherwise the first reading the card has. Empty when it has none.
 */
export function displayReading(card: {
  targetLang: string
  readings: Record<string, string>
}): string {
  const r = card.readings
  if (card.targetLang === 'ja') return r.kana || ''
  if (card.targetLang === 'zh') return r.zhuyin || (r.pinyin ? pinyinToZhuyin(r.pinyin) : '')
  return Object.values(r).find(Boolean) ?? ''
}
