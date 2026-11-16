/**
 * Per-deck overrides (docs/DESIGN.md §13.8). A generated deck can pin its own
 * rules so it does not depend on the learner's global study preferences: the
 * script its readings are written in, whether those readings (ruby) are shown,
 * the character variant it was authored in, and which exercise kinds it offers.
 */

export type CharacterVariant = 'traditional' | 'simplified'

/**
 * Where the learner's remembered deck prompt lives in `user_settings`. The same
 * prompt is reused for every new deck (and for existing decks that only carry
 * the generic import wording), so a deck's rules never start over.
 */
export const DECK_INSTRUCTION_KEY = 'deckInstruction'

export type ReadingScript =
  'zhuyin' | 'pinyin' | 'kana' | 'romaji' | 'latin' | 'none' | (string & {})

export interface DeckSettings {
  /** Override: show native readings (Zhuyin / furigana) for this deck. */
  showReadings?: boolean
  /** The script the deck's readings are written in (zhuyin, kana, …). */
  readingScript?: ReadingScript
  /** Character variant the deck was authored in (Chinese). */
  variant?: CharacterVariant
  /** Exercise ids disabled for this deck (in addition to the user's own). */
  disabledExercises?: string[]
  /** Ask the generator for pitch-accent metadata (Japanese, …). */
  pitchAccent?: boolean
  /** Growth cursor: the frequency rank the deck has been generated up to. */
  cursor?: number
  /** How many new words each organic-growth batch should add. */
  batchSize?: number
  /** The instruction the deck was created from (for provenance + regrowth). */
  instruction?: string
  /** Where the words came from: a frequency list, or an imported deck. */
  wordSource?: 'frequency' | 'anki'
  /** The source word list (imported decks), so the deck can grow without it. */
  words?: string[]
  /**
   * True while a background build is still generating this deck's cards. The
   * Learn tab watches it to show progress; a restart clears it (see
   * `clearDeckBuilds`), so a half-built deck is never stuck.
   */
  building?: boolean
  /** How many words the running build will introduce in total (progress bar). */
  buildTotal?: number
  /** The error that stopped a background build, so the UI can say why. */
  buildError?: string
}

/** Parses a stored settings blob, ignoring anything malformed. */
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

/** Merges a partial update onto existing settings. */
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

/**
 * Whether native readings (ruby) should be shown for a deck. A deck-level
 * override wins over the learner's global study preference; with neither set the
 * caller's fallback applies.
 */
export function deckShowsReadings(settings: DeckSettings): boolean | undefined {
  return settings.showReadings
}
