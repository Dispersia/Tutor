import type { Db } from '../db/client'
import { addCard, createDeck, listDecks } from '../db/repo'
import { STARTER_DECKS } from './decks'
import { FREQUENCY } from './frequency'
import { pinyinToZhuyin } from './zhuyin'

/** Level id of the frequency (n+1) path. */
export const FREQUENCY_LEVEL = 'zhfreq'

/**
 * Gives a (new) user their own copy of the curated starter decks: the frequency
 * spine (one new word per step) plus HSK 1 and JLPT N5. Idempotent.
 */
export function seedStarterDecks(db: Db, userId: string): boolean {
  if (listDecks(db, userId).length > 0) return false
  for (const d of STARTER_DECKS) {
    const deck = createDeck(db, userId, {
      name: d.name,
      sourceLang: d.sourceLang,
      targetLang: d.targetLang,
      level: d.level,
      description: d.description,
    })
    for (const c of d.cards) {
      addCard(db, userId, {
        deckId: deck.id,
        sourceLang: d.sourceLang,
        targetLang: d.targetLang,
        front: c.front,
        back: c.back,
        readings: readingsFor(d.targetLang, c.reading, c.kana),
        tags: [d.level],
        origin: 'curated',
      })
    }
  }
  seedFrequencyDeck(db, userId)
  return true
}

/** The frequency path: the ordered word list, one card per word. */
function seedFrequencyDeck(db: Db, userId: string): void {
  const deck = createDeck(db, userId, {
    name: 'Mandarin · Frequency',
    sourceLang: 'en',
    targetLang: 'zh',
    level: FREQUENCY_LEVEL,
    description: 'The most common Mandarin words, one step at a time',
  })
  for (const w of FREQUENCY) {
    addCard(db, userId, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: 'zh',
      front: w.en,
      back: w.word,
      readings: readingsFor('zh', w.pinyin),
      tags: [FREQUENCY_LEVEL, w.pos],
      payload: { pos: w.pos },
      origin: 'curated',
    })
  }
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
