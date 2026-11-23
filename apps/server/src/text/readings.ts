import { pinyinToZhuyin } from './zhuyin'

export type ReadingKey = 'kana' | 'zhuyin' | 'pinyin' | 'reading'

const isChinese = (lang: string): boolean => lang === 'zh' || lang === 'yue'
const LATIN = /[a-zA-Z]/

export function readingKey(targetLang: string, reading: string, script?: string): ReadingKey {
  if (targetLang === 'ja') return 'kana'
  if (!isChinese(targetLang)) return 'reading'
  if (script === 'pinyin') return 'pinyin'
  return targetLang === 'yue' && LATIN.test(reading) ? 'reading' : 'zhuyin'
}

function readingKeysFor(targetLang: string): ReadingKey[] {
  if (targetLang === 'ja') return ['kana']
  return isChinese(targetLang) ? ['zhuyin', 'pinyin', 'reading'] : ['reading']
}

export interface ReadingSource {
  targetLang: string
  reading: string | undefined
  script?: string
  fallbackZhuyin?: () => string | undefined
}

export function storedReadings(src: ReadingSource): Record<string, string> {
  const { targetLang, reading } = src
  if (!reading) return {}
  const key = readingKey(targetLang, reading, src.script)
  if (key !== 'zhuyin' || !LATIN.test(reading)) return { [key]: reading }
  const zhuyin = zhuyinFromPinyin(reading) ?? src.fallbackZhuyin?.()
  return zhuyin ? { zhuyin } : {}
}

export function withReading(
  readings: Record<string, string>,
  src: ReadingSource,
): Record<string, string> {
  const next = { ...readings }
  if (src.reading === undefined) return next
  for (const key of readingKeysFor(src.targetLang)) delete next[key]
  return { ...next, ...storedReadings(src) }
}

export function zhuyinFromPinyin(reading: string): string | undefined {
  const cleaned = reading.replace(/[^\p{L}\p{M}\p{N}\s'’]/gu, ' ')
  const zhuyin = pinyinToZhuyin(cleaned)
  return zhuyin && !zhuyin.includes('?') ? zhuyin : undefined
}

export function displayReading(card: {
  targetLang: string
  readings: Record<string, string>
}): string {
  const r = card.readings
  if (card.targetLang === 'ja') return r.kana || ''
  if (card.targetLang === 'zh') return r.zhuyin || (r.pinyin ? pinyinToZhuyin(r.pinyin) : '')
  return Object.values(r).find(Boolean) ?? ''
}
