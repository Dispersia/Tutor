export type CharacterVariant = 'traditional' | 'simplified'

export interface FrequencyWord {
  word: string
  rank: number
  count: number
}

export interface FrequencySource {
  lang: string
  url: string
  label: string
}

const BASE = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018'

export function frequencySourceFor(
  targetLang: string,
  variant?: CharacterVariant,
): FrequencySource | undefined {
  if (targetLang === 'zh') return chineseSource(variant)
  if (targetLang === 'ja') return { lang: 'ja', url: `${BASE}/ja/ja_full.txt`, label: 'ja' }
  if (!/^[a-z]{2}(_[a-z]{2})?$/.test(targetLang)) return undefined
  return {
    lang: targetLang,
    url: `${BASE}/${targetLang}/${targetLang}_50k.txt`,
    label: targetLang,
  }
}

function chineseSource(variant?: CharacterVariant): FrequencySource {
  const code = variant === 'simplified' ? 'zh_cn' : 'zh_tw'
  return {
    lang: 'zh',
    url: `${BASE}/${code}/${code}_50k.txt`,
    label: `${code} (${code === 'zh_tw' ? 'Traditional' : 'Simplified'})`,
  }
}

export type Fetcher = (url: string) => Promise<string>

const FETCH_TIMEOUT_MS = 30_000

const downloaded = new Map<string, Promise<string>>()

async function download(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'tutor' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`frequency list ${url} -> ${res.status}`)
  return res.text()
}

export const defaultFetcher: Fetcher = (url) => {
  let list = downloaded.get(url)
  if (!list) {
    list = download(url).catch((err: unknown) => {
      downloaded.delete(url)
      throw err
    })
    downloaded.set(url, list)
  }
  return list
}

function isWord(token: string): boolean {
  if (!token || token.length > 24) return false
  return /\p{L}/u.test(token)
}

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

export async function fetchFrequencyWords(
  targetLang: string,
  opts: {
    limit?: number
    variant?: CharacterVariant
    fetcher?: Fetcher
    source?: FrequencySource
  } = {},
): Promise<{ source: FrequencySource; words: FrequencyWord[] }> {
  const source = opts.source ?? frequencySourceFor(targetLang, opts.variant)
  if (!source) throw new Error(`no frequency list for language "${targetLang}"`)
  const fetcher = opts.fetcher ?? defaultFetcher
  const text = await fetcher(source.url)
  return { source, words: parseFrequencyList(text, opts.limit ?? 2000) }
}
