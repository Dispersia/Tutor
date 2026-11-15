import type { Db } from '../db/client'
import {
  addCard,
  createDeck,
  deleteDeck,
  getUserSetting,
  listCards,
  listDecks,
  setUserSetting,
  updateCard,
} from '../db/repo'
import { FREQUENCY } from './frequency'
import { FREQUENCY_JA } from './frequency-ja'
import { pinyinToZhuyin } from './zhuyin'

/** Level id of the Mandarin frequency (n+1) path. */
export const FREQUENCY_LEVEL = 'zhfreq'
/** Level id of the Japanese frequency path. */
export const JAPANESE_FREQUENCY_LEVEL = 'jafreq'

/**
 * Bump when the curated seed data changes. Existing users keep their original
 * copy of the decks (seeding only runs once), so `reconcileStarterDecks` uses
 * this to know when a repair pass is due.
 *
 * v2: Simplified -> Traditional and pinyin -> Zhuyin.
 * v3: drop the themed HSK 1 / JLPT N5 decks; frequency paths only, plus Japanese.
 */
export const SEED_VERSION = 3
const SEED_VERSION_KEY = 'seedVersion'

/** Themed decks that used to be seeded; removed in favour of the frequency path. */
const LEGACY_LEVELS = ['hsk1', 'n5']

/** One curated card in the shape the seeder/reconciler works with. */
interface SeedContent {
  front: string
  back: string
  readings: Record<string, string>
  tags: string[]
  payload?: Record<string, unknown>
}

interface FrequencyDeck {
  level: string
  name: string
  targetLang: string
  description: string
  content: SeedContent[]
}

function starterDecks(): FrequencyDeck[] {
  return [
    {
      level: FREQUENCY_LEVEL,
      name: 'Mandarin · Frequency',
      targetLang: 'zh',
      description: 'The most common Mandarin words, one step at a time',
      content: FREQUENCY.map((w) => ({
        front: w.en,
        back: w.word,
        readings: readingsFor('zh', w.pinyin),
        tags: [FREQUENCY_LEVEL, w.pos],
        payload: { pos: w.pos },
      })),
    },
    {
      level: JAPANESE_FREQUENCY_LEVEL,
      name: 'Japanese · Frequency',
      targetLang: 'ja',
      description: 'The most common Japanese words, one step at a time',
      content: FREQUENCY_JA.map((w) => ({
        front: w.en,
        back: w.word,
        readings: readingsFor('ja', w.romaji, w.kana),
        tags: [JAPANESE_FREQUENCY_LEVEL, w.pos],
        payload: { pos: w.pos },
      })),
    },
  ]
}

/**
 * Gives a (new) user their own copy of the frequency decks — the Mandarin and
 * Japanese word lists, one new word per step — then repairs any existing copy.
 * Idempotent.
 */
export function seedStarterDecks(db: Db, userId: string): boolean {
  const created = listDecks(db, userId).length === 0
  reconcileStarterDecks(db, userId)
  return created
}

/**
 * Brings an existing user's decks in line with the current seed data: seeds any
 * frequency deck they never got, updates cards in place (so SRS history
 * survives) and drops the retired themed decks. Runs once per SEED_VERSION.
 */
export function reconcileStarterDecks(db: Db, userId: string): void {
  if (getUserSetting(db, userId, SEED_VERSION_KEY) === String(SEED_VERSION)) return
  for (const level of LEGACY_LEVELS) {
    const deck = listDecks(db, userId).find((d) => d.level === level)
    if (deck) deleteDeck(db, deck.id, userId)
  }
  for (const d of starterDecks()) {
    const deck = listDecks(db, userId).find((x) => x.level === d.level)
    if (!deck) {
      seedDeck(db, userId, d)
      continue
    }
    reconcileCards(db, userId, deck.id, d.targetLang, d.content)
  }
  setUserSetting(db, userId, SEED_VERSION_KEY, String(SEED_VERSION))
}

function seedDeck(db: Db, userId: string, d: FrequencyDeck): void {
  const deck = createDeck(db, userId, {
    name: d.name,
    sourceLang: 'en',
    targetLang: d.targetLang,
    level: d.level,
    description: d.description,
  })
  for (const c of d.content) {
    addCard(db, userId, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: d.targetLang,
      ...c,
      origin: 'curated',
    })
  }
}

/** Matches stored cards to the seed by position (curated decks are append-only). */
function reconcileCards(
  db: Db,
  userId: string,
  deckId: string,
  targetLang: string,
  seed: readonly SeedContent[],
): void {
  const existing = listCards(db, userId, deckId)
  seed.forEach((c, i) => {
    const card = existing[i]
    if (!card) {
      addCard(db, userId, { deckId, sourceLang: 'en', targetLang, ...c, origin: 'curated' })
      return
    }
    if (
      card.front !== c.front ||
      card.back !== c.back ||
      !sameReadings(card.readings, c.readings)
    ) {
      updateCard(db, card.id, userId, { front: c.front, back: c.back, readings: c.readings })
    }
  })
}

function sameReadings(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/**
 * The readings a card carries — native phonetic script only, no Latin
 * transliteration: Chinese gets **Zhuyin**, Japanese gets **kana** (rendered as
 * furigana over the kanji). The pinyin/romaji source is used only to derive it.
 */
export function readingsFor(
  targetLang: string,
  reading: string,
  kana?: string,
): Record<string, string> {
  if (targetLang === 'ja') {
    return { kana: kana || reading }
  }
  return { zhuyin: pinyinToZhuyin(reading) }
}
