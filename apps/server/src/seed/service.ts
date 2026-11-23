import type { UserId, DeckId } from '../ids'
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
  type ServerCard,
} from '../db/repo'
import { FREQUENCY } from '../text/lexicon'
import { FREQUENCY_JA } from './frequency-ja'
import { storedReadings } from '../text/readings'

export const FREQUENCY_LEVEL = 'zhfreq'
export const JAPANESE_FREQUENCY_LEVEL = 'jafreq'

export const SEED_VERSION = 3
const SEED_VERSION_KEY = 'seedVersion'

const LEGACY_LEVELS = ['hsk1', 'n5']

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
  return [mandarinDeck(), japaneseDeck()]
}

function mandarinDeck(): FrequencyDeck {
  return {
    level: FREQUENCY_LEVEL,
    name: 'Mandarin · Frequency',
    targetLang: 'zh',
    description: 'The most common Mandarin words, one step at a time',
    content: FREQUENCY.map((w) =>
      seedCard(FREQUENCY_LEVEL, w.en, w.word, readingsFor('zh', w.pinyin), w.pos),
    ),
  }
}

function japaneseDeck(): FrequencyDeck {
  return {
    level: JAPANESE_FREQUENCY_LEVEL,
    name: 'Japanese · Frequency',
    targetLang: 'ja',
    description: 'The most common Japanese words, one step at a time',
    content: FREQUENCY_JA.map((w) =>
      seedCard(JAPANESE_FREQUENCY_LEVEL, w.en, w.word, readingsFor('ja', w.romaji, w.kana), w.pos),
    ),
  }
}

function seedCard(
  level: string,
  front: string,
  back: string,
  readings: Record<string, string>,
  pos: string,
): SeedContent {
  return { front, back, readings, tags: [level, pos], payload: { pos } }
}

export function seedStarterDecks(db: Db, userId: UserId): boolean {
  const created = listDecks(db).length === 0
  reconcileStarterDecks(db, userId)
  return created
}

export function reconcileStarterDecks(db: Db, userId: UserId): void {
  if (getUserSetting(db, userId, SEED_VERSION_KEY) === String(SEED_VERSION)) return
  for (const level of LEGACY_LEVELS) {
    const deck = listDecks(db).find((d) => d.level === level)
    if (deck) deleteDeck(db, deck.id)
  }
  for (const d of starterDecks()) {
    const deck = listDecks(db).find((x) => x.level === d.level)
    if (!deck) {
      seedDeck(db, userId, d)
      continue
    }
    reconcileCards(db, userId, deck.id, d.targetLang, d.content)
  }
  setUserSetting(db, userId, SEED_VERSION_KEY, String(SEED_VERSION))
}

function seedDeck(db: Db, userId: UserId, d: FrequencyDeck): void {
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

function reconcileCards(
  db: Db,
  userId: UserId,
  deckId: DeckId,
  targetLang: string,
  seed: readonly SeedContent[],
): void {
  const existing = listCards(db, userId, deckId)
  const ctx: ReconcileCtx = { db, userId, deckId, targetLang }
  seed.forEach((c, i) => reconcileCard(ctx, existing[i], c))
}

interface ReconcileCtx {
  db: Db
  userId: UserId
  deckId: DeckId
  targetLang: string
}

function reconcileCard(ctx: ReconcileCtx, card: ServerCard | undefined, seed: SeedContent): void {
  if (!card) {
    addCard(ctx.db, ctx.userId, {
      deckId: ctx.deckId,
      sourceLang: 'en',
      targetLang: ctx.targetLang,
      ...seed,
      origin: 'curated',
    })
    return
  }
  const same = card.front === seed.front && card.back === seed.back
  if (same && sameReadings(card.readings, seed.readings)) return
  updateCard(ctx.db, card.id, {
    front: seed.front,
    back: seed.back,
    readings: seed.readings,
  })
}

function sameReadings(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

export function readingsFor(
  targetLang: string,
  reading: string,
  kana?: string,
): Record<string, string> {
  const native = targetLang === 'ja' ? kana || reading : reading
  return storedReadings({ targetLang, reading: native })
}
