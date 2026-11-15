import type { AnkiDeck } from './parse'

/**
 * Turns Anki notes into an ordered word list (docs/DESIGN.md §13.7) — the same
 * shape a frequency list yields, so an uploaded deck is just another source.
 *
 * Which field holds the word is guessed from the model's field names, then from
 * the target script, and can be overridden by index. Reading/meaning fields are
 * picked up too and passed to the planner as hints.
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

const WORD_FIELD = /(^|[\s_\-])(word|expression|term|vocab|vocabulary|front|kanji|hanzi|character|外語|単語|單字|生詞|生词|詞|词|字)/i
const READING_FIELD = /(reading|pronunciation|pron|pinyin|kana|furigana|romaji|yomi|読み|発音|拼音|注音)/i
const MEANING_FIELD = /(meaning|definition|english|translation|gloss|sense|back|意思|釋義|释义|翻譯|翻译|中文|英文)/i

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

/** The field names of the model with the most fields (decks are usually one model). */
export function dominantModelFields(deck: AnkiDeck): string[] {
  let best: string[] = []
  for (const model of Object.values(deck.models)) {
    if (model.fields.length > best.length) best = model.fields
  }
  return best
}

/** Best-guess field indices (used only to pre-select the pickers). */
export function suggestAnkiFields(
  deck: AnkiDeck,
  targetLang: string,
): { wordField: number; readingField: number; meaningField: number } {
  const fields = dominantModelFields(deck)
  const rows = deck.notes.map((n) => n.fields.map(cleanField))
  return {
    wordField: pickWordField(fields, rows, targetLang),
    readingField: fields.findIndex((f) => READING_FIELD.test(f)),
    meaningField: fields.findIndex((f) => MEANING_FIELD.test(f)),
  }
}

/** What a deck looks like before the learner picks its fields. */
export function inspectAnki(deck: AnkiDeck, targetLang: string): AnkiInspection {
  return {
    name: deck.name,
    fields: dominantModelFields(deck),
    sample: deck.notes.slice(0, 5).map((n) => n.fields.map(cleanField)),
    noteCount: deck.notes.length,
    suggested: suggestAnkiFields(deck, targetLang),
  }
}

/** Picks the field index that holds the target word. */
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

/**
 * Extracts an ordered, de-duplicated word list from a deck's notes. `wordField`
 * overrides the guessed field index.
 */
export function wordsFromAnki(
  deck: AnkiDeck,
  targetLang: string,
  opts: WordFieldOptions = {},
): AnkiWordList {
  const fields = dominantModelFields(deck)
  const rows = deck.notes.map((n) => n.fields.map(cleanField))
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
