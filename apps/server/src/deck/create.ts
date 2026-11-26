import type { UserId, DeckId } from '../ids'
import { createDeck } from '../db/repo'
import type { Db } from '../db/client'
import { fetchFrequencyWords, frequencySourceFor } from '../frequency/source'
import type { BuildDeckOptions } from './context'
import { DEFAULT_COUNT, MAX_DECK_WORDS, PLAN_CHUNK, clamp } from './instruction'
import type { DeckSettings } from './settings'

export interface CreateDeckResult {
  deckId: DeckId
  name: string
  candidates: string[]
  sourceLabel: string
  count: number
}

interface WordSource {
  candidates: string[]
  label: string
  kind: 'frequency' | 'anki' | 'path'
}

export async function createDeckForBuild(
  db: Db,
  userId: UserId,
  opts: BuildDeckOptions,
): Promise<CreateDeckResult> {
  const count = clamp(opts.count ?? DEFAULT_COUNT, 1, MAX_DECK_WORDS)
  const source = await resolveWords(opts, count)
  const name = opts.name?.trim() || `${opts.topic ?? opts.targetLang} · generated`
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Generated from ${source.label}`,
    settings: deckSettings(opts, count, source),
  })
  return { deckId: deck.id, name, candidates: source.candidates, sourceLabel: source.label, count }
}

async function resolveWords(opts: BuildDeckOptions, count: number): Promise<WordSource> {
  if (opts.words?.length) {
    return {
      candidates: opts.words,
      label: opts.sourceLabel ?? 'uploaded deck',
      kind: opts.kind === 'path' ? 'path' : 'anki',
    }
  }
  const source = frequencySourceFor(opts.targetLang, opts.variant)
  if (!source) throw new Error(`no frequency list for language "${opts.targetLang}"`)
  const { words } = await fetchFrequencyWords(opts.targetLang, {
    variant: opts.variant,
    fetcher: opts.fetcher,
    source,
    limit: clamp(count + 200, 300, MAX_DECK_WORDS),
  })
  return { candidates: words.map((w) => w.word), label: source.label, kind: 'frequency' }
}

function deckSettings(opts: BuildDeckOptions, count: number, source: WordSource): DeckSettings {
  const path = opts.kind === 'path'
  return {
    variant: opts.variant,
    readingScript: opts.readingScript,
    showReadings: opts.showReadings,
    disabledExercises: opts.disabledExercises,
    pitchAccent: opts.pitchAccent,
    cursor: 0,
    batchSize: Math.min(count, PLAN_CHUNK),
    instruction: opts.instruction,
    wordSource: source.kind === 'anki' ? 'anki' : 'frequency',
    kind: opts.kind,
    autoGrow: path ? true : undefined,
    batchWords: path ? Math.min(count, PLAN_CHUNK) : undefined,
    words: source.kind === 'anki' ? source.candidates.slice(0, MAX_DECK_WORDS) : undefined,
  }
}
