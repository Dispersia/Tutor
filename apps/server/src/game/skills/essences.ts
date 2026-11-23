/**
 * Distillation essences (docs/DESIGN.md §13.5.3.2) — content and its helpers.
 */

import type { ItemDef } from './types'

// --- distillation (docs/DESIGN.md §13.5.3.2) ---------------------------------
//
// Enchanting has **one** track, `Distill`: break down an item to learn from it.
// The more a thing is worth in coins, the more it teaches — at a percentage, so an
// endgame piece levels faster but never instantly. Breaking it down also yields the
// **essence** of its family, the reagent every enchant is built from.

export type EssenceId = 'metal' | 'cloth' | 'leather' | 'wood' | 'gem'

export const ESSENCES: { id: EssenceId; name: string; icon: string }[] = [
  { id: 'metal', name: 'Metal essence', icon: '🔩' },
  { id: 'cloth', name: 'Cloth essence', icon: '🧵' },
  { id: 'leather', name: 'Leather essence', icon: '🟫' },
  { id: 'wood', name: 'Wood essence', icon: '🪵' },
  { id: 'gem', name: 'Gem essence', icon: '💎' },
]

export const essenceId = (e: EssenceId) => `${e}_essence`

const ESSENCE_BY_FAMILY = new Set<EssenceId>(ESSENCES.map((e) => e.id))

/** Which essence an item distills into, by what it is made of. */
export function essenceFamily(item: ItemDef): EssenceId {
  if (item.tags?.includes('bow') || item.tags?.includes('staff')) return 'wood'
  if (item.armourType && ESSENCE_BY_FAMILY.has(item.armourType as EssenceId)) {
    return item.armourType as EssenceId
  }
  const id = item.id
  if (
    id.includes('log') ||
    id === 'plank' ||
    id === 'ash' ||
    (id.includes('dust') && id.includes('wood'))
  )
    return 'wood'
  if (id === 'hide' || id.includes('leather')) return 'leather'
  if (id === 'wool' || id === 'cloth' || id.includes('silk') || id.includes('cloth')) return 'cloth'
  if (
    id.includes('gem') ||
    id.includes('ruby') ||
    id.includes('emerald') ||
    id.includes('sapphire') ||
    id.includes('dust')
  )
    return 'gem'
  if (
    id.includes('rune') ||
    id.includes('essence') ||
    id.includes('ore') ||
    id.includes('bar') ||
    id === 'coal'
  )
    return 'metal'
  return 'metal'
}
