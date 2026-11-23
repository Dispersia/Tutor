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
  let kana = 0
  let han = 0
  let hangul = 0
  let cyrillic = 0
  let arabic = 0
  for (const note of dominantNotes(deck).slice(0, 200)) {
    for (const field of note.fields) {
      for (const ch of cleanField(field)) {
        const c = ch.codePointAt(0)!
        if (c >= 0x3040 && c <= 0x30ff) kana++
        else if (c >= 0x4e00 && c <= 0x9fff) han++
        else if (c >= 0xac00 && c <= 0xd7af) hangul++
        else if (c >= 0x0400 && c <= 0x04ff) cyrillic++
        else if (c >= 0x0600 && c <= 0x06ff) arabic++
      }
    }
  }
  if (kana > 0) return 'ja'
  if (hangul > 0) return 'ko'
  if (han > 0) return 'zh'
  if (cyrillic > 0) return 'ru'
  if (arabic > 0) return 'ar'
  return undefined
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
  const wordField = opts.wordField ?? pickWordField(fields, rows, targetLang)
  const readingField = opts.readingField ?? fields.findIndex((f) => READING_FIELD.test(f))
  const meaningField = opts.meaningField ?? fields.findIndex((f) => MEANING_FIELD.test(f))

  const words: string[] = []
  const readings: Record<string, string> = {}
  const meanings: Record<string, string> = {}
  const seen = new Set<string>()
  const limit = opts.limit ?? 5000

  for (const row of rows) {
    const word = row[wordField] ?? ''
    if (!word || seen.has(word)) continue
    seen.add(word)
    words.push(word)
    if (readingField >= 0 && row[readingField]) readings[word] = row[readingField]!
    if (meaningField >= 0 && row[meaningField]) meanings[word] = row[meaningField]!.slice(0, 200)
    if (words.length >= limit) break
  }
  return { words, readings, meanings, fields, wordField, readingField, meaningField }
}
