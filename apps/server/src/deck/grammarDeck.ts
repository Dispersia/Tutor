import type { UserId, DeckId } from '../ids'
import type { Db } from '../db/client'
import { addCard, createDeck } from '../db/repo'
import type { GrammarEntry } from '../anki/words'
import { storedReadings } from '../text/readings'
import type { DeckSettings } from './settings'

export const MAX_GRAMMAR_POINTS = 500

export interface GrammarDeckOptions {
  name: string
  sourceLang: string
  targetLang: string
  entries: GrammarEntry[]
  readingScript?: string
  sourceLabel?: string
}

export interface GrammarDeckResult {
  deckId: DeckId
  name: string
  cardCount: number
}

export function createGrammarDeck(
  db: Db,
  userId: UserId,
  opts: GrammarDeckOptions,
): GrammarDeckResult {
  const name = opts.name.trim() || `${opts.targetLang} · grammar`
  const entries = opts.entries.slice(0, MAX_GRAMMAR_POINTS)
  const deck = createDeck(db, userId, {
    name,
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    description: `Grammar points from ${opts.sourceLabel ?? 'an imported deck'}`,
    settings: grammarSettings(opts, entries.length),
  })
  const target: CardTarget = { db, userId, deckId: deck.id, opts }
  entries.forEach((entry, i) => addGrammarCard(target, entry, i + 1))
  return { deckId: deck.id, name, cardCount: entries.length }
}

function grammarSettings(opts: GrammarDeckOptions, count: number): DeckSettings {
  return {
    readingScript: opts.readingScript,
    wordSource: 'anki',
    cursor: count,
    batchSize: count,
  }
}

interface CardTarget {
  db: Db
  userId: UserId
  deckId: DeckId
  opts: GrammarDeckOptions
}

function addGrammarCard(target: CardTarget, entry: GrammarEntry, step: number): void {
  const { db, userId, deckId, opts } = target
  const rule = entry.rule.trim() || entry.pattern
  addCard(db, userId, {
    deckId,
    type: 'grammar',
    sourceLang: opts.sourceLang,
    targetLang: opts.targetLang,
    front: rule,
    back: entry.pattern,
    readings: storedReadings({
      targetLang: opts.targetLang,
      reading: entry.reading,
      script: opts.readingScript,
    }),
    tags: [opts.targetLang, 'grammar'],
    payload: { template: 'grammar', rule, answer: entry.pattern, step },
    origin: 'manual',
  })
}
