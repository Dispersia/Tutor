import { publicDeckSettings, type DeckSettings } from '../../deck/settings'

export function deckView<T extends { settings?: DeckSettings }>(deck: T): T {
  return deck.settings ? { ...deck, settings: publicDeckSettings(deck.settings) } : deck
}
