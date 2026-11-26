import { api } from './api'
import { toast } from './toast.svelte'
import type { Deck } from './exercises'

class ActiveDeckState {
  decks = $state<Deck[]>([])
  id = $state<string | null>(null)
  loaded = $state(false)
}

export const activeDeck = new ActiveDeckState()

export function activeDeckOf(): Deck | undefined {
  return activeDeck.decks.find((d) => d.id === activeDeck.id) ?? activeDeck.decks[0]
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
    toast('Could not load your decks', 'error')
  } finally {
    activeDeck.loaded = true
  }
}

export async function setActiveDeck(id: string | null): Promise<void> {
  const previous = activeDeck.id
  activeDeck.id = id
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ study: { activeDeckId: id ?? '' } }),
    })
  } catch {
    activeDeck.id = previous
    toast('Could not save the active deck', 'error')
  }
}
