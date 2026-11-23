/** The deck wire view (docs/ARCHITECTURE.md). */

import { publicDeckSettings, type DeckSettings } from '../../deck/settings'

/** A deck as sent to a client — without the server-only source word list. */
export function deckView<T extends { settings?: DeckSettings }>(deck: T): T {
  return deck.settings ? { ...deck, settings: publicDeckSettings(deck.settings) } : deck
}
