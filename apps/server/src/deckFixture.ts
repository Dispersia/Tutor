import type { Db } from './db/client'
import type { UserId } from './ids'
import { addCard, createDeck } from './db/repo'
import { FREQUENCY_JA } from './text/frequency-ja'
import { FREQUENCY } from './text/lexicon'
import { readingsFor } from './text/readings'

const MANDARIN_LEVEL = 'zhfreq'
const JAPANESE_LEVEL = 'jafreq'

interface FixtureCard {
  front: string
  back: string
  readings: Record<string, string>
  tags: string[]
  payload: Record<string, unknown>
}

interface FixtureDeck {
  level: string
  name: string
  targetLang: string
  description: string
  cards: FixtureCard[]
}

function fixtureCard(
  level: string,
  front: string,
  back: string,
  readings: Record<string, string>,
  pos: string,
): FixtureCard {
  return { front, back, readings, tags: [level, pos], payload: { pos } }
}

function mandarinDeck(): FixtureDeck {
  return {
    level: MANDARIN_LEVEL,
    name: 'Mandarin · Frequency',
    targetLang: 'zh',
    description: 'The most common Mandarin words, one step at a time',
    cards: FREQUENCY.map((w) =>
      fixtureCard(MANDARIN_LEVEL, w.en, w.word, readingsFor('zh', w.pinyin), w.pos),
    ),
  }
}

function japaneseDeck(): FixtureDeck {
  return {
    level: JAPANESE_LEVEL,
    name: 'Japanese · Frequency',
    targetLang: 'ja',
    description: 'The most common Japanese words, one step at a time',
    cards: FREQUENCY_JA.map((w) =>
      fixtureCard(JAPANESE_LEVEL, w.en, w.word, readingsFor('ja', w.romaji, w.kana), w.pos),
    ),
  }
}

function insertDeck(db: Db, userId: UserId, d: FixtureDeck): void {
  const deck = createDeck(db, userId, {
    name: d.name,
    sourceLang: 'en',
    targetLang: d.targetLang,
    level: d.level,
    description: d.description,
  })
  for (const c of d.cards) {
    addCard(db, userId, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: d.targetLang,
      ...c,
      origin: 'curated',
    })
  }
}

export function createFixtureDecks(db: Db, userId: UserId): void {
  for (const d of [mandarinDeck(), japaneseDeck()]) insertDeck(db, userId, d)
}
