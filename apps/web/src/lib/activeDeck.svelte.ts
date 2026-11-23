import { api } from './api'
import type { Deck } from './exercises'

class ActiveDeckState {
  decks = $state<Deck[]>([])
  id = $state<string | null>(null)
  loaded = $state(false)
}

export const activeDeck = new ActiveDeckState()

export function activeDeckOf(): Deck | undefined {
  return activeDeck.id ? activeDeck.decks.find((d) => d.id === activeDeck.id) : undefined
}

export async function loadActiveDeck(): Promise<void> {
  try {
    const [{ decks }, settings] = await Promise.all([
      api<{ decks: Deck[] }>('/api/decks'),
      api<{ study?: { activeDeckId?: string | null } }>('/api/settings'),
    ])
    activeDeck.decks = decks
    const saved = settings.study?.activeDeckId ?? null
    activeDeck.id = saved && decks.some((d) => d.id === saved) ? saved : null
  } catch {
  } finally {
    activeDeck.loaded = true
  }
}

export async function setActiveDeck(id: string | null): Promise<void> {
  activeDeck.id = id
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ study: { activeDeckId: id ?? '' } }),
    })
  } catch {}
}
