import type { CharacterVariant, Fetcher } from '../frequency/source'
import { fetchFrequencyWords } from '../frequency/source'
import { langName } from '../llm/prompts'
import { FREQUENCY_JA } from '../text/frequency-ja'
import { FREQUENCY } from '../text/lexicon'
import { MAX_DECK_WORDS } from './instruction'
import { lexiconOrder } from './lexicon'

const PATH_KIND = 'path'
export const PATH_BATCH = 10
export const PATH_AHEAD = 3

export function isPath(kind: string | undefined): boolean {
  return kind === PATH_KIND
}

export function pathDeckName(targetLang: string): string {
  return `${langName(targetLang)} · Path`
}

export function pathInstruction(targetLang: string): string {
  return [
    `A growing everyday ${langName(targetLang)} path for reading manga, manhwa and manhua.`,
    'Teach the language people really speak: dialogue, feelings, people, places, food, school, work, plans and small talk.',
    'Never academic or exam language — nothing kept only for a proficiency test.',
    'Every new word gets one short, natural sentence a character would actually say.',
    'Include grammar: one point at a time, as a fill-in-the-blank completed with a single word, once the known words can show it.',
    'Order the words so the ones that unlock the most everyday sentences come first.',
  ].join(' ')
}

const JA_PATH_FIRST = [
  '私',
  'あなた',
  '人',
  'です',
  'は',
  'か',
  'これ',
  '何',
  '学生',
  '先生',
  '友達',
  'も',
  'の',
]

const KO_PATH_FIRST = [
  '저',
  '학생',
  '이에요',
  '는',
  '사람',
  '있어요',
  '이거',
  '뭐',
  '네',
  '아니요',
  '선생님',
  '친구',
  '없어요',
  '좋아요',
  '주세요',
]

export function pathSeedWords(targetLang: string, variant?: CharacterVariant): string[] {
  if (targetLang === 'zh' && variant !== 'simplified') return FREQUENCY.map((w) => w.word)
  if (targetLang === 'ja')
    return orderPathWords(
      JA_PATH_FIRST,
      FREQUENCY_JA.map((w) => w.word),
    )
  if (targetLang === 'ko') return KO_PATH_FIRST
  return []
}

export function orderPathWords(seed: string[], frequency: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const word of [...seed, ...frequency]) {
    if (!word || seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out.slice(0, MAX_DECK_WORDS)
}

export interface PathWordsOptions {
  variant?: CharacterVariant
  fetcher?: Fetcher
  saved?: string[]
}

export async function pathWords(
  targetLang: string,
  opts: PathWordsOptions = {},
): Promise<string[]> {
  const stored = lexiconOrder(targetLang)
  if (stored?.length) return orderPathWords(pathSeedWords(targetLang, opts.variant), stored)
  const { words } = await fetchFrequencyWords(targetLang, {
    variant: opts.variant,
    fetcher: opts.fetcher,
    limit: MAX_DECK_WORDS,
  })
  const base = orderPathWords(
    opts.saved ?? [],
    words.map((w) => w.word),
  )
  return orderPathWords(pathSeedWords(targetLang, opts.variant), base)
}
