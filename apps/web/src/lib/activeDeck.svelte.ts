import { api } from './api'
import type { Deck } from './exercises'

/**
 * The deck the member studies **everywhere** — free practice, the Learn path,
 * and any surface that asks the server for "the next drill". It is a per-account
 * study preference (`study.activeDeckId`, docs/DESIGN.md §13.8), so the choice
 * made in the profile menu follows the member across devices and screens.
 *
 * This module keeps the current value and the deck list in one place, so the
 * profile menu, Learn and Practice all read and write the same state.
 */
class ActiveDeckState {
  /** Every deck the member owns (as the API returns them, by name). */
  decks = $state<Deck[]>([])
  /** The chosen deck id, or null for "all decks" free practice. */
  id = $state<string | null>(null)
  loaded = $state(false)
}

export const activeDeck = new ActiveDeckState()

/** The chosen deck's row, when one is set and still exists. */
export function activeDeckOf(): Deck | undefined {
  return activeDeck.id ? activeDeck.decks.find((d) => d.id === activeDeck.id) : undefined
}

/**
 * Loads the deck list and the saved choice. Safe to call from every screen; it
 * re-reads each time so a deck built on Learn appears in the profile menu
 * without a full reload.
 */
export async function loadActiveDeck(): Promise<void> {
  try {
    const [{ decks }, settings] = await Promise.all([
      api<{ decks: Deck[] }>('/api/decks'),
      api<{ study?: { activeDeckId?: string | null } }>('/api/settings'),
    ])
    activeDeck.decks = decks
    const saved = settings.study?.activeDeckId ?? null
    // A deck deleted elsewhere must not leave a dangling choice behind.
    activeDeck.id = saved && decks.some((d) => d.id === saved) ? saved : null
  } catch {
    // Best effort: the picker hides itself when there are no decks, and the
    // server falls back to all decks when nothing is chosen.
  } finally {
    activeDeck.loaded = true
  }
}

/** Chooses the deck used everywhere and persists it to the account. */
export async function setActiveDeck(id: string | null): Promise<void> {
  activeDeck.id = id
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ study: { activeDeckId: id ?? '' } }),
    })
  } catch {
    // Keep the optimistic value; the next load reconciles with the server.
  }
}
