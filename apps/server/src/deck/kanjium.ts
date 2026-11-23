import accentsTxt from './kanjium-accents.txt'
import { pitchFromAccent, type PitchContour } from '@tutor/core'

type WordIndex = Map<string, Map<string, number[]>>
type ReadingIndex = Map<string, number[]>

interface AccentIndex {
  word: WordIndex
  reading: ReadingIndex
}

let cached: AccentIndex | undefined

function push(map: Map<string, number[]>, key: string, accents: number[]): void {
  let list = map.get(key)
  if (!list) map.set(key, (list = []))
  for (const a of accents) if (!list.includes(a)) list.push(a)
}

function buildIndex(): AccentIndex {
  const word: WordIndex = new Map()
  const reading: ReadingIndex = new Map()
  for (const line of accentsTxt.split('\n')) {
    const row = parseLine(line)
    if (!row) continue
    let byReading = word.get(row.head)
    if (!byReading) word.set(row.head, (byReading = new Map()))
    push(byReading, row.kana, row.accents)
    if (row.kana) push(reading, row.kana, row.accents)
  }
  return { word, reading }
}

interface DictRow {
  head: string
  kana: string
  accents: number[]
}

function parseLine(line: string): DictRow | undefined {
  if (!line) return undefined
  const tab = line.indexOf('\t')
  if (tab < 0) return undefined
  const head = line.slice(0, tab)
  const rest = line.slice(tab + 1)
  const tab2 = rest.indexOf('\t')
  if (tab2 < 0) return undefined
  const kana = rest.slice(0, tab2)
  const accents = rest
    .slice(tab2 + 1)
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0)
  if (!head || accents.length === 0) return undefined
  return { head, kana, accents }
}

function index(): AccentIndex {
  return (cached ??= buildIndex())
}

export function kanjiumReadings(word: string): string[] {
  return [...(index().word.get(word)?.keys() ?? [])].filter(Boolean)
}

function isKanaWord(word: string): boolean {
  return /^[\u3040-\u30ff\u30fc]+$/.test(word)
}

export function accentFor(word: string, reading: string): number | undefined {
  const i = index()
  const byReading = i.word.get(word)
  if (byReading) {
    const fromWord = wordAccent(byReading, reading, word)
    if (fromWord !== undefined) return fromWord
  }
  if (!isKanaWord(word) && reading) return singleReadingAccent(i.reading.get(reading))
  return undefined
}

function wordAccent(
  byReading: Map<string, number[]>,
  reading: string,
  word: string,
): number | undefined {
  if (reading) {
    const exact = byReading.get(reading)
    if (exact?.[0] !== undefined) return exact[0]
  }
  const kanaOnly = byReading.get('')
  if (kanaOnly?.[0] !== undefined) return kanaOnly[0]
  if (!isKanaWord(word) && byReading.size === 1) {
    const only = [...byReading.values()][0]
    if (only?.[0] !== undefined) return only[0]
  }
  return undefined
}

function singleReadingAccent(byKana: number[] | undefined): number | undefined {
  const distinct = byKana ? [...new Set(byKana)] : []
  return distinct.length === 1 ? distinct[0] : undefined
}

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ')

export function splitMorae(reading: string): string[] {
  const morae: string[] = []
  for (const ch of reading) {
    const last = morae[morae.length - 1]
    if (last !== undefined && SMALL_KANA.has(ch)) morae[morae.length - 1] = last + ch
    else morae.push(ch)
  }
  return morae
}

export function kanjiumContour(word: string, reading: string): PitchContour | undefined {
  const accent = accentFor(word, reading)
  if (accent === undefined) return undefined
  const morae = splitMorae(reading || word)
  if (morae.length === 0) return undefined
  return { levels: pitchFromAccent(accent, morae.length), drop: accent, syllables: morae }
}
