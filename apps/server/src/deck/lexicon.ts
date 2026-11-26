import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { env } from '../env'

export interface LexiconEntry {
  rank: number
  reading?: string
  meaning?: string
}

export interface Lexicon {
  lang: string
  words: Record<string, LexiconEntry>
}

export interface LexiconHint {
  reading?: string
  meaning?: string
}

export function lexiconFile(lang: string, dataDir: string = env.dataDir): string {
  return join(dataDir, 'lexicon', `${lang}.json`)
}

export function readLexicon(file: string): Lexicon | undefined {
  if (!existsSync(file)) return undefined
  try {
    return asLexicon(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

function asLexicon(raw: unknown): Lexicon | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const words = (raw as { words?: unknown }).words
  if (!words || typeof words !== 'object' || Array.isArray(words)) return undefined
  const lang = (raw as { lang?: unknown }).lang
  return { lang: typeof lang === 'string' ? lang : '', words: words as Lexicon['words'] }
}

export function writeLexicon(file: string, lex: Lexicon): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(lex))
}

const cache = new Map<string, Map<string, LexiconEntry> | null>()

export function loadLexicon(lang: string): Map<string, LexiconEntry> | undefined {
  if (!cache.has(lang)) {
    const lex = readLexicon(lexiconFile(lang))
    cache.set(lang, lex ? new Map(Object.entries(lex.words)) : null)
  }
  return cache.get(lang) ?? undefined
}

export function lexiconOrder(lang: string): string[] | undefined {
  const map = loadLexicon(lang)
  if (!map?.size) return undefined
  return [...map.entries()].sort((a, b) => a[1].rank - b[1].rank).map(([word]) => word)
}

export function lexiconHints(lang: string, words: string[]): Record<string, LexiconHint> {
  const map = loadLexicon(lang)
  const out: Record<string, LexiconHint> = {}
  if (!map) return out
  for (const word of words) {
    const hint = hintOf(map.get(word))
    if (hint) out[word] = hint
  }
  return out
}

function hintOf(entry: LexiconEntry | undefined): LexiconHint | undefined {
  if (!entry) return undefined
  const hint: LexiconHint = {}
  if (entry.reading) hint.reading = entry.reading
  if (entry.meaning) hint.meaning = entry.meaning
  return hint.reading || hint.meaning ? hint : undefined
}
