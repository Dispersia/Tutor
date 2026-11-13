import type { Db } from '../db/client'
import { addCard, createDeck, listDecks } from '../db/repo'
import { STARTER_DECKS } from './decks'

/** Gives a (new) user their own copy of the curated starter decks. Idempotent. */
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
        readings: { [d.targetLang === 'ja' ? 'romaji' : 'pinyin']: c.reading },
        tags: [d.level],
        origin: 'curated',
      })
    }
  }
  return true
}
