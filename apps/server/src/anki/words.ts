import type { AnkiDeck, AnkiNote } from './parse'

/**
 * Turns Anki notes into an ordered word list (docs/DESIGN.md §13.7) — the same
 * shape a frequency list yields, so an uploaded deck is just another source.
 *
 * Which field holds the word is chosen by the learner in the UI; this module
 * only pre-selects a sensible default and extracts the chosen fields. A package
 * can carry several note types, so everything is scoped to the model that most
 * notes use.
 */

export interface AnkiWordList {
  words: string[]
  /** word → native reading (when a reading field was found) */
  readings: Record<string, string>
  /** word → meaning (when a meaning field was found) */
  meanings: Record<string, string>
  /** The model's field names, in order. */
  fields: string[]
  /** The field index used as the word. */
  wordField: number
  readingField: number
  meaningField: number
}

/** What a deck looks like before the learner picks its fields. */
export interface AnkiInspection {
  name?: string
  /** The model's field names, in order. */
  fields: string[]
  /** A few notes' cleaned fields, for a preview table. */
  sample: string[][]
  noteCount: number
  /** Best-guess field indices, used only to pre-select the pickers. */
  suggested: { wordField: number; readingField: number; meaningField: number }
  /** Target language guessed from the deck's script (kana → Japanese, …). */
  suggestedLang?: string
}

export interface WordFieldOptions {
  /** Explicit field index for the word (required by the UI, guessed as a fallback). */
  wordField?: number
  /** Explicit reading field index, or -1 for none. */
  readingField?: number
  /** Explicit meaning field index, or -1 for none. */
  meaningField?: number
  limit?: number
}

const WORD_FIELD =
  /(^|[\s_-])(word|expression|term|vocab|vocabulary|front|kanji|hanzi|character|外語|単語|單字|生詞|生词|詞|词|字)/i
const READING_FIELD =
  /(reading|pronunciation|pron|pinyin|kana|furigana|romaji|yomi|読み|発音|拼音|注音)/i
const MEANING_FIELD =
  /(meaning|definition|english|translation|gloss|sense|back|意思|釋義|释义|翻譯|翻译|中文|英文)/i

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** Strips Anki HTML/sound markup and collapses whitespace. */
export function cleanField(s: string): string {
  return s
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fraction of characters in a CJK script. */
function cjkRatio(s: string): number {
  if (!s) return 0
  let n = 0
  for (const ch of s) if (CJK.test(ch)) n++
  return n / [...s].length
}

/** The note type most notes use (a package can carry more than one). */
function dominantMid(deck: AnkiDeck): number | undefined {
  const counts = new Map<number, number>()
  for (const n of deck.notes) counts.set(n.mid, (counts.get(n.mid) ?? 0) + 1)
  let best: number | undefined
  let bestN = -1
  for (const [mid, n] of counts) {
    if (n > bestN) {
      bestN = n
      best = mid
    }
  }
  return best
}

/** The notes of the dominant model, in deck order. */
function dominantNotes(deck: AnkiDeck): AnkiNote[] {
  const mid = dominantMid(deck)
  if (mid === undefined) return deck.notes
  const subset = deck.notes.filter((n) => n.mid === mid)
  return subset.length ? subset : deck.notes
}

/** Field names of the dominant model, or generic labels sized to the data. */
function modelFields(deck: AnkiDeck, notes: AnkiNote[]): string[] {
  const mid = dominantMid(deck)
  const named = mid !== undefined ? deck.models[String(mid)]?.fields : undefined
  if (named?.length) return named
  let best: string[] = []
  for (const model of Object.values(deck.models)) {
    if (model.fields.length > best.length) best = model.fields
  }
  if (best.length) return best
  const width = notes.reduce((max, n) => Math.max(max, n.fields.length), 0)
  return Array.from({ length: width }, (_, i) => `Field ${i + 1}`)
}

/** Picks the field index that most likely holds the target word. */
function pickWordField(fields: string[], rows: string[][], targetLang: string): number {
  const named = fields.findIndex((f) => WORD_FIELD.test(f))
  if (named >= 0) return named
  const cjk = targetLang === 'zh' || targetLang === 'ja' || targetLang === 'yue'
  if (cjk) {
    // the field whose values are mostly target-script characters
    let bestIdx = 0
    let bestScore = -1
    fields.forEach((_, i) => {
      const score = rows.reduce((sum, r) => sum + cjkRatio(r[i] ?? ''), 0)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    })
    return bestIdx
  }
  return 0
}

/** The cleaned field rows of the dominant model. */
function rowsOf(notes: AnkiNote[]): string[][] {
  return notes.map((n) => n.fields.map(cleanField))
}

/**
 * Guesses the target language from the script the deck is written in. Kana wins
 * over Han (Japanese uses both), Hangul is Korean, Han alone is Chinese. Latin
 * scripts are ambiguous, so they return undefined and the caller decides.
 */
export function detectLanguage(deck: AnkiDeck): string | undefined {
  const counts = scriptCounts(dominantNotes(deck).slice(0, 200))
  if (counts.kana > 0) return 'ja'
  if (counts.hangul > 0) return 'ko'
  if (counts.han > 0) return 'zh'
  if (counts.cyrillic > 0) return 'ru'
  if (counts.arabic > 0) return 'ar'
  return undefined
}

interface ScriptCounts {
  kana: number
  han: number
  hangul: number
  cyrillic: number
  arabic: number
}

function scriptCounts(notes: AnkiNote[]): ScriptCounts {
  const counts: ScriptCounts = { kana: 0, han: 0, hangul: 0, cyrillic: 0, arabic: 0 }
  for (const note of notes) for (const field of note.fields) countField(field, counts)
  return counts
}

function countField(field: string, counts: ScriptCounts): void {
  for (const ch of cleanField(field)) {
    const c = ch.codePointAt(0)!
    if (c >= 0x3040 && c <= 0x30ff) counts.kana++
    else if (c >= 0x4e00 && c <= 0x9fff) counts.han++
    else if (c >= 0xac00 && c <= 0xd7af) counts.hangul++
    else if (c >= 0x0400 && c <= 0x04ff) counts.cyrillic++
    else if (c >= 0x0600 && c <= 0x06ff) counts.arabic++
  }
}

/** Best-guess field indices (used only to pre-select the pickers). */
export function suggestAnkiFields(
  deck: AnkiDeck,
  targetLang: string,
): { wordField: number; readingField: number; meaningField: number } {
  const notes = dominantNotes(deck)
  const fields = modelFields(deck, notes)
  const rows = rowsOf(notes)
  return {
    wordField: pickWordField(fields, rows, targetLang),
    readingField: fields.findIndex((f) => READING_FIELD.test(f)),
    meaningField: fields.findIndex((f) => MEANING_FIELD.test(f)),
  }
}

/** What a deck looks like before the learner picks its fields. */
export function inspectAnki(deck: AnkiDeck, targetLang: string): AnkiInspection {
  const notes = dominantNotes(deck)
  return {
    name: deck.name,
    fields: modelFields(deck, notes),
    sample: rowsOf(notes.slice(0, 5)),
    noteCount: notes.length,
    suggested: suggestAnkiFields(deck, targetLang),
    suggestedLang: detectLanguage(deck),
  }
}

/**
 * Extracts an ordered, de-duplicated word list from a deck's notes. `wordField`
 * (and optional reading/meaning fields) come from the learner's choice; the
 * indices are guessed only when they are not supplied.
 */
export function wordsFromAnki(
  deck: AnkiDeck,
  targetLang: string,
  opts: WordFieldOptions = {},
): AnkiWordList {
  const notes = dominantNotes(deck)
  const fields = modelFields(deck, notes)
  const rows = rowsOf(notes)
  const idx = fieldIndices(fields, rows, targetLang, opts)
  return extractWords(rows, fields, idx, opts.limit ?? 5000)
}

interface WordFields {
  wordField: number
  readingField: number
  meaningField: number
}

function fieldIndices(
  fields: string[],
  rows: string[][],
  targetLang: string,
  opts: WordFieldOptions,
): WordFields {
  return {
    wordField: opts.wordField ?? pickWordField(fields, rows, targetLang),
    readingField: opts.readingField ?? fields.findIndex((f) => READING_FIELD.test(f)),
    meaningField: opts.meaningField ?? fields.findIndex((f) => MEANING_FIELD.test(f)),
  }
}

function extractWords(
  rows: string[][],
  fields: string[],
  idx: WordFields,
  limit: number,
): AnkiWordList {
  const out: AnkiWordList = { words: [], readings: {}, meanings: {}, fields, ...idx }
  const seen = new Set<string>()
  for (const row of rows) {
    if (!addWord(out, seen, row, idx)) continue
    if (out.words.length >= limit) break
  }
  return out
}

/** Adds one row's word (and its reading/meaning); false when it is a duplicate. */
function addWord(out: AnkiWordList, seen: Set<string>, row: string[], idx: WordFields): boolean {
  const word = row[idx.wordField] ?? ''
  if (!word || seen.has(word)) return false
  seen.add(word)
  out.words.push(word)
  if (idx.readingField >= 0 && row[idx.readingField]) out.readings[word] = row[idx.readingField]!
  if (idx.meaningField >= 0 && row[idx.meaningField]) {
    out.meanings[word] = row[idx.meaningField]!.slice(0, 200)
  }
  return true
}
