/**
 * Japanese pitch accent, resolved from the bundled **Kanjium** dictionary.
 *
 * Cards ask the generator for a contour (`deck/plan.ts`, `deck/pitch.ts`), but a
 * language model guesses the accent and gets it wrong often — 毎日 comes back
 * heiban [0] instead of 頭高 [1]. This module answers the same question from a
 * real accent dictionary instead, so the contour is looked up, not invented.
 *
 * Data: `kanjium-accents.txt`, the `accents.txt` table from the Kanjium project
 * (https://github.com/mifunetoshiro/kanjium), licensed CC BY-SA 4.0. Each line is
 * `<headword>\t<reading>\t<accent[,accent]>`, where an accent is the mora *after*
 * which the pitch falls (0 = heiban 平板), the same numbering `pitchFromAccent`
 * and the card's `drop` use. The accents and mora split are computed here; only
 * the numbers come from the file.
 */

import accentsTxt from './kanjium-accents.txt'
import { pitchFromAccent, type PitchContour } from '@tutor/core'

/** headword -> (reading | '') -> accents, in file order (kana-only words use ''). */
type WordIndex = Map<string, Map<string, number[]>>
/** reading -> accents across every headword, in file order. */
type ReadingIndex = Map<string, number[]>

interface AccentIndex {
  word: WordIndex
  reading: ReadingIndex
}

let cached: AccentIndex | undefined

/** Adds accents to a list, keeping first-seen order and dropping duplicates. */
function push(map: Map<string, number[]>, key: string, accents: number[]): void {
  let list = map.get(key)
  if (!list) map.set(key, (list = []))
  for (const a of accents) if (!list.includes(a)) list.push(a)
}

/** Parses the tab-separated dictionary into the two lookup maps (once). */
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

/** One `head<TAB>kana<TAB>accents` dictionary line, or undefined. */
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

/** Whether a spelling is written only in kana (so its headword may itself be the reading). */
function isKanaWord(word: string): boolean {
  return /^[\u3040-\u30ff\u30fc]+$/.test(word)
}

/**
 * The standard accent number for a word, or `undefined` when the dictionary is
 * unsure. Tries the exact spelling + reading first, then a kana-only headword,
 * then a headword with a single reading. A word written only in kana is never
 * matched by reading alone: the demonstrative あれ is absent from the source,
 * and its reading would otherwise match 荒れ [0] — a different word.
 */
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

/** The accent from the word's own readings: exact, kana-only, then the sole one. */
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

/** Only trust a reading that names a single accent; homophones differ (はし). */
function singleReadingAccent(byKana: number[] | undefined): number | undefined {
  const distinct = byKana ? [...new Set(byKana)] : []
  return distinct.length === 1 ? distinct[0] : undefined
}

/** Small kana that bind to the preceding mora (ゅ in きゅ, etc.). */
const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ')

/** Splits kana into morae: small kana join the mora before them. */
export function splitMorae(reading: string): string[] {
  const morae: string[] = []
  for (const ch of reading) {
    const last = morae[morae.length - 1]
    if (last !== undefined && SMALL_KANA.has(ch)) morae[morae.length - 1] = last + ch
    else morae.push(ch)
  }
  return morae
}

/**
 * The pitch contour for a word from the dictionary, or `undefined` when it has
 * no confident answer. Levels are derived here so they always agree with the
 * accent number; morae come from the reading (never from the model).
 */
export function kanjiumContour(word: string, reading: string): PitchContour | undefined {
  const accent = accentFor(word, reading)
  if (accent === undefined) return undefined
  const morae = splitMorae(reading || word)
  if (morae.length === 0) return undefined
  return { levels: pitchFromAccent(accent, morae.length), drop: accent, syllables: morae }
}
