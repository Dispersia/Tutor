import accentsTxt from '../deck/kanjium-accents.txt'
import readingsTxt from '../deck/mandarin-readings.txt'
import { loadLexicon } from '../deck/lexicon'
import { FREQUENCY_JA } from '../text/frequency-ja'
import { FREQUENCY } from '../text/lexicon'

interface ImeIndex {
  exact: Map<string, string[]>
  bare: Map<string, string[]>
}

const MAX_WORD = 6
const MAX_SEGMENT = 6
const LIMIT = 9
const PER_KEY = 60
const SINGLE_SYLLABLE = 2_000_000
const TONES = /[ˊˇˋ˙ˉ]/g
const INITIALS = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ'
const MEDIALS = 'ㄧㄨㄩ'
const FINALS = 'ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ'
const TONE_CHARS = 'ˊˇˋ˙ˉ'

let zhCache: ImeIndex | undefined
let jaCache: ImeIndex | undefined

function emptyIndex(): ImeIndex {
  return { exact: new Map(), bare: new Map() }
}

function push(map: Map<string, string[]>, key: string, word: string): void {
  if (!key) return
  const list = map.get(key)
  if (!list) {
    map.set(key, [word])
    return
  }
  if (list.length < PER_KEY && !list.includes(word)) list.push(word)
}

function add(index: ImeIndex, key: string, word: string): void {
  push(index.exact, key, word)
  push(index.bare, key.replace(TONES, ''), word)
}

function buildZh(): ImeIndex {
  const index = emptyIndex()
  for (const line of readingsTxt.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const word = line.slice(0, tab)
    const reading = line.slice(tab + 1).trim()
    if (!word || !reading || word.length > MAX_WORD) continue
    add(index, reading, word)
  }
  return index
}

function buildJa(): ImeIndex {
  const index = emptyIndex()
  for (const line of accentsTxt.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const head = line.slice(0, tab)
    const rest = line.slice(tab + 1)
    const kana = rest.slice(0, rest.indexOf('\t'))
    if (!head || !kana || head.length > MAX_WORD) continue
    add(index, kana, head)
  }
  return index
}

function indexFor(lang: string): ImeIndex | undefined {
  if (lang === 'zh') return (zhCache ??= buildZh())
  if (lang === 'ja') return (jaCache ??= buildJa())
  return undefined
}

function curated(lang: string): Map<string, number> {
  const map = new Map<string, number>()
  const words = lang === 'ja' ? FREQUENCY_JA.map((w) => w.word) : FREQUENCY.map((w) => w.word)
  words.forEach((word, rank) => {
    if (!map.has(word)) map.set(word, rank)
  })
  return map
}

const CURATED = new Map<string, Map<string, number>>()

function curatedRank(lang: string): Map<string, number> {
  let map = CURATED.get(lang)
  if (!map) CURATED.set(lang, (map = curated(lang)))
  return map
}

function score(word: string, lang: string): number {
  const curated = curatedRank(lang).get(word)
  if (curated !== undefined) return curated
  const ranked = loadLexicon(lang)?.get(word)?.rank
  if (ranked !== undefined) return 1000 + ranked
  return 1_000_000 - word.length
}

function sorted(words: string[], lang: string): string[] {
  return [...words].sort((a, b) => score(a, lang) - score(b, lang))
}

function bestOf(words: string[], lang: string): { word: string; score: number } {
  const word = sorted(words, lang)[0]!
  return { word, score: score(word, lang) }
}

function lookupWords(index: ImeIndex, key: string): string[] | undefined {
  const direct = index.exact.get(key)
  const soft = index.bare.get(key.replace(TONES, ''))
  if (direct && soft && direct !== soft) return [...new Set([...direct, ...soft])]
  return direct ?? soft
}

function startsSyllable(ch: string): boolean {
  return INITIALS.includes(ch) || MEDIALS.includes(ch) || FINALS.includes(ch)
}

function syllableSize(text: string, at: number): number {
  let i = at
  if (text[i] === '˙' && startsSyllable(text[i + 1] ?? '')) i++
  if (INITIALS.includes(text[i] ?? '')) i++
  if (MEDIALS.includes(text[i] ?? '')) i++
  if (FINALS.includes(text[i] ?? '')) i++
  if (TONE_CHARS.includes(text[i] ?? '')) i++
  return Math.max(1, i - at)
}

function segmentZhuyin(text: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    if (text[at] === ' ') {
      at++
      continue
    }
    const size = syllableSize(text, at)
    out.push(text.slice(at, at + size))
    at += size
  }
  return out
}

function bestZh(
  index: ImeIndex,
  syllables: string[],
  at: number,
  lang: string,
): { word: string; span: number } {
  const max = Math.min(MAX_SEGMENT, syllables.length - at)
  let pick: { word: string; span: number; score: number } | undefined
  for (let span = 1; span <= max; span++) {
    const words = lookupWords(index, syllables.slice(at, at + span).join(' '))
    if (!words?.length) continue
    const found = bestOf(words, lang)
    const score = found.score + (span === 1 ? SINGLE_SYLLABLE : 0)
    if (!pick || score < pick.score || (score === pick.score && span > pick.span)) {
      pick = { word: found.word, span, score }
    }
  }
  return pick ?? { word: syllables[at]!, span: 1 }
}

function greedyZh(index: ImeIndex, query: string, lang: string): string {
  const syllables = segmentZhuyin(query)
  const out: string[] = []
  let at = 0
  while (at < syllables.length) {
    const match = bestZh(index, syllables, at, lang)
    out.push(match.word)
    at += match.span
  }
  return out.join('')
}

function knownWord(lang: string, word: string): boolean {
  return curatedRank(lang).has(word) || loadLexicon(lang)?.get(word)?.rank !== undefined
}

function bestJa(
  index: ImeIndex,
  query: string,
  at: number,
  lang: string,
): { word: string; length: number } {
  const max = Math.min(MAX_SEGMENT, query.length - at)
  for (let length = max; length >= 2; length--) {
    const reading = query.slice(at, at + length)
    if (knownWord(lang, reading)) return { word: reading, length }
    const words = lookupWords(index, reading)
    if (words?.length) return { word: sorted(words, lang)[0]!, length }
  }
  return { word: query[at]!, length: 1 }
}

interface JaSegment {
  word: string
  reading: string
  length: number
}

function jaSegments(index: ImeIndex, query: string, lang: string): JaSegment[] {
  const out: JaSegment[] = []
  let at = 0
  while (at < query.length) {
    const match = bestJa(index, query, at, lang)
    out.push({ ...match, reading: query.slice(at, at + match.length) })
    at += match.length
  }
  return out
}

function jaOptions(index: ImeIndex, segments: JaSegment[], lang: string): string[] {
  for (let at = segments.length - 1; at >= 0; at--) {
    const options = segmentOptions(index, segments, at, lang)
    if (options.length) return options
  }
  return []
}

function joinJa(segments: JaSegment[], from: number, to: number): string {
  return segments
    .slice(from, to)
    .map((s) => s.word)
    .join('')
}

function segmentOptions(
  index: ImeIndex,
  segments: JaSegment[],
  at: number,
  lang: string,
): string[] {
  const segment = segments[at]!
  if (segment.reading.length < 2) return []
  const before = joinJa(segments, 0, at)
  const after = joinJa(segments, at + 1, segments.length)
  const out = sorted(lookupWords(index, segment.reading) ?? [], lang).map(
    (word) => before + word + after,
  )
  if (segment.word !== segment.reading) out.push(before + segment.reading + after)
  return out
}

function jaCandidates(index: ImeIndex, query: string, lang: string): string[] {
  const segments = jaSegments(index, query, lang)
  const list = [segments.map((s) => s.word).join(''), ...jaOptions(index, segments, lang), query]
  return [...new Set(list)].slice(0, LIMIT)
}

export function imeCandidates(lang: string, keys: string): string[] {
  const index = indexFor(lang)
  if (!index) return []
  const query = keys.replace(/\s+/g, ' ').trim()
  if (!query) return []
  if (lang === 'ja') return jaCandidates(index, query, lang)
  const list = [greedyZh(index, query, lang)]
  const whole = segmentZhuyin(query).join(' ')
  const exact = lookupWords(index, whole)
  if (exact?.length) list.push(...sorted(exact, lang).slice(0, LIMIT))
  return [...new Set(list)].slice(0, LIMIT)
}
