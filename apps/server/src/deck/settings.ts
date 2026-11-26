import type { CharacterVariant } from '../frequency/source'

export type { CharacterVariant }

export const DECK_INSTRUCTION_KEY = 'deckInstruction'

type ReadingScript = 'zhuyin' | 'pinyin' | 'kana' | 'romaji' | 'latin' | 'none' | (string & {})

interface WordHint {
  reading?: string
  meaning?: string
}

export interface DeckSettings {
  showReadings?: boolean
  readingScript?: ReadingScript
  variant?: CharacterVariant
  disabledExercises?: string[]
  pitchAccent?: boolean
  cursor?: number
  batchSize?: number
  instruction?: string
  wordSource?: 'frequency' | 'anki'
  kind?: 'path' | 'custom'
  autoGrow?: boolean
  batchWords?: number
  words?: string[]
  hints?: Record<string, WordHint>
  building?: boolean
  buildTotal?: number
  buildError?: string
}

export function publicDeckSettings(settings: DeckSettings): DeckSettings {
  const { words: _words, hints: _hints, ...rest } = settings
  return rest
}

export function parseDeckSettings(json: string | null | undefined): DeckSettings {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as DeckSettings
  } catch {
    return {}
  }
}

export function mergeDeckSettings(
  current: DeckSettings,
  patch: Partial<DeckSettings>,
): DeckSettings {
  const next: DeckSettings = { ...current, ...patch }
  if (patch.disabledExercises !== undefined) {
    next.disabledExercises = patch.disabledExercises.filter((x) => typeof x === 'string')
  }
  return next
}
