/**
 * Frequency lists (docs/DESIGN.md §13.7).
 *
 * The deck builder does not ship a word list: it *pulls* one down, so the words
 * are real and current, then hands the raw words to the generator. The source is
 * Hermit Dave's FrequencyWords (MIT), which publishes a `<word> <count>` list
 * per language — including Traditional Chinese (`zh_tw`).
 *
 * Everything here is pure and injectable: `fetchFrequencyWords` takes a fetcher,
 * so tests run with no network.
 */

export type CharacterVariant = 'traditional' | 'simplified'

export interface FrequencyWord {
  word: string
  /** 1-based position in the list (frequency order). */
  rank: number
  count: number
}

export interface FrequencySource {
  /** Language tag the source serves. */
  lang: string
  /** Raw URL of the `<word> <count>` list. */
  url: string
  /** Human label for provenance, e.g. "zh_tw (Traditional)". */
  label: string
}

const BASE = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018'

/** The frequency list URL for a target language (+ variant), or undefined. */
export function frequencySourceFor(
  targetLang: string,
  variant?: CharacterVariant,
): FrequencySource | undefined {
  if (targetLang === 'zh') {
    const code = variant === 'simplified' ? 'zh_cn' : 'zh_tw'
    return {
      lang: 'zh',
      url: `${BASE}/${code}/${code}_50k.txt`,
      label: `${code} (${code === 'zh_tw' ? 'Traditional' : 'Simplified'})`,
    }
  }
  // Japanese ships a single `ja_full.txt`.
  if (targetLang === 'ja') {
    return { lang: 'ja', url: `${BASE}/ja/ja_full.txt`, label: 'ja' }
  }
  if (!/^[a-z]{2}(_[a-z]{2})?$/.test(targetLang)) return undefined
  return {
    lang: targetLang,
    url: `${BASE}/${targetLang}/${targetLang}_50k.txt`,
    label: targetLang,
  }
}

export type Fetcher = (url: string) => Promise<string>

/** Default fetcher: a plain GET, returning the body as text. */
export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'tutor' } })
  if (!res.ok) throw new Error(`frequency list ${url} -> ${res.status}`)
  return res.text()
}

/** True for a token we would want to teach (a word, not punctuation/numbers). */
function isWord(token: string): boolean {
  if (!token || token.length > 24) return false
  // must contain at least one letter; drops punctuation, symbols and bare numbers
  return /\p{L}/u.test(token)
}

/**
 * Parses a `<word> <count>` list into ranked words. Malformed lines are skipped,
 * duplicates are collapsed, and `limit` caps how many we keep.
 */
export function parseFrequencyList(text: string, limit = 2000): FrequencyWord[] {
  const out: FrequencyWord[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const sp = line.indexOf(' ')
    if (sp <= 0) continue
    const word = line.slice(0, sp).trim()
    const count = Number(line.slice(sp + 1).trim())
    if (!isWord(word) || !Number.isFinite(count)) continue
    if (seen.has(word)) continue
    seen.add(word)
    out.push({ word, rank: out.length + 1, count })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Pulls a frequency list and returns its ranked words. `source` defaults to the
 * one for `targetLang`.
 */
export async function fetchFrequencyWords(
  targetLang: string,
  opts: { limit?: number; variant?: CharacterVariant; fetcher?: Fetcher; source?: FrequencySource } = {},
): Promise<{ source: FrequencySource; words: FrequencyWord[] }> {
  const source = opts.source ?? frequencySourceFor(targetLang, opts.variant)
  if (!source) throw new Error(`no frequency list for language "${targetLang}"`)
  const fetcher = opts.fetcher ?? defaultFetcher
  const text = await fetcher(source.url)
  return { source, words: parseFrequencyList(text, opts.limit ?? 2000) }
}
