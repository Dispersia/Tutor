import type { Db } from '../db/client'
import type { ChatMessage, OpenRouter, ReasoningEffort } from '../llm/openrouter'
import { listCards, listDecks } from '../db/repo'
import { FREQUENCY } from '../text/lexicon'
import { hasReadingScript, zhuyinFromPinyin } from '../text/readings'
import { FREQUENCY_JA } from '../seed/frequency-ja'
import type { Lexicon, LexiconEntry } from './lexicon'

export interface WordInfo {
  reading?: string
  meaning?: string
}

export interface Coverage {
  total: number
  meanings: number
  readings: number
}

export function curatedWords(lang: string): Map<string, WordInfo> {
  if (lang === 'zh') return new Map(FREQUENCY.map((w) => [w.word, chineseInfo(w.pinyin, w.en)]))
  if (lang === 'ja') {
    return new Map(FREQUENCY_JA.map((w) => [w.word, { reading: w.kana, meaning: w.en }]))
  }
  return new Map()
}

function chineseInfo(pinyin: string, en: string): WordInfo {
  return { reading: zhuyinFromPinyin(pinyin) ?? pinyin, meaning: en }
}

export function harvestWords(db: Db, lang: string): Map<string, WordInfo> {
  const out = new Map<string, WordInfo>()
  for (const deck of listDecks(db)) {
    if (deck.targetLang !== lang) continue
    for (const card of listCards(db, undefined, deck.id)) {
      const info = cardInfo(lang, card)
      if (info) mergeInfo(out, card.back, info)
    }
  }
  return out
}

function cardInfo(
  lang: string,
  card: { back: string; front: string; readings: Record<string, string> },
): WordInfo | undefined {
  if (!isSingleWord(card.back)) return undefined
  const reading = readingOf(lang, card.readings)
  const meaning = card.front.trim()
  if (!reading && !meaning) return undefined
  return { reading, meaning: meaning || undefined }
}

function isSingleWord(text: string): boolean {
  if (!text || text.length > 24 || /\s/.test(text)) return false
  return !/[.!?。！？,，、]/.test(text)
}

function readingOf(lang: string, readings: Record<string, string>): string | undefined {
  if (lang === 'ja') return readings.kana
  if (lang === 'zh' || lang === 'yue') {
    return readings.zhuyin ?? zhuyinFromPinyin(readings.pinyin ?? '')
  }
  return undefined
}

function mergeInfo(map: Map<string, WordInfo>, word: string, info: WordInfo): void {
  const prev = map.get(word)
  if (!prev) {
    map.set(word, info)
    return
  }
  map.set(word, {
    reading: prev.reading ?? info.reading,
    meaning: prev.meaning ?? info.meaning,
  })
}

export function buildLexicon(
  lang: string,
  order: string[],
  sources: Map<string, WordInfo>[],
): Lexicon {
  const words: Record<string, LexiconEntry> = {}
  order.forEach((word, i) => {
    words[word] = entryFor(word, i + 1, sources)
  })
  if (!hasReadingScript(lang)) for (const entry of Object.values(words)) delete entry.reading
  return { lang, words }
}

function entryFor(word: string, rank: number, sources: Map<string, WordInfo>[]): LexiconEntry {
  const entry: LexiconEntry = { rank }
  for (const source of sources) {
    const info = source.get(word)
    if (!info) continue
    if (!entry.reading && info.reading) entry.reading = info.reading
    if (!entry.meaning && info.meaning) entry.meaning = info.meaning
  }
  return entry
}

export function coverage(lex: Lexicon): Coverage {
  const entries = Object.values(lex.words)
  return {
    total: entries.length,
    meanings: entries.filter((e) => e.meaning).length,
    readings: entries.filter((e) => e.reading).length,
  }
}

export function wordsMissingMeanings(lex: Lexicon, limit: number): string[] {
  return Object.entries(lex.words)
    .filter(([, entry]) => !entry.meaning)
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, limit)
    .map(([word]) => word)
}

export const MEANING_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: { word: { type: 'string' }, meaning: { type: 'string' } },
        required: ['word', 'meaning'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
}

const MEANING_SYSTEM = `You write the meaning of one word for a language learner. For each word give its most common everyday meaning in English, separated with " / " when it has several common senses. Give only the meaning: no pronunciation, no part-of-speech label, no example, no notes. Return only the JSON.`

export function meaningMessages(lang: string, words: string[]): ChatMessage[] {
  return [
    { role: 'system', content: MEANING_SYSTEM },
    { role: 'user', content: `Language: ${lang}\nWords: ${words.join(' ')}` },
  ]
}

export async function fetchMeanings(
  or: OpenRouter,
  model: string,
  reasoning: ReasoningEffort,
  lang: string,
  words: string[],
): Promise<Map<string, string>> {
  const { json } = await or.chatJSON<{ entries: { word: string; meaning: string }[] }>({
    model,
    schema: MEANING_SCHEMA,
    schemaName: 'meanings',
    reasoning,
    temperature: 0.3,
    messages: meaningMessages(lang, words),
  })
  return meaningsFrom(json.entries ?? [], new Set(words))
}

function meaningsFrom(
  entries: { word: string; meaning: string }[],
  asked: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of entries) {
    if (asked.has(entry.word) && entry.meaning?.trim()) out.set(entry.word, entry.meaning.trim())
  }
  return out
}
