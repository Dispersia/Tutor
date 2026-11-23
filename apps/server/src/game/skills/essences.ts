import type { ItemDef } from './types'

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

export function essenceFamily(item: ItemDef): EssenceId {
  if (item.tags?.includes('bow') || item.tags?.includes('staff')) return 'wood'
  if (item.armourType && ESSENCE_BY_FAMILY.has(item.armourType as EssenceId)) {
    return item.armourType as EssenceId
  }
  return idFamily(item.id)
}

function idFamily(id: string): EssenceId {
  if (isWood(id)) return 'wood'
  if (id === 'hide' || id.includes('leather')) return 'leather'
  if (isCloth(id)) return 'cloth'
  if (isGem(id)) return 'gem'
  return 'metal'
}

const isWood = (id: string): boolean =>
  id.includes('log') ||
  id === 'plank' ||
  id === 'ash' ||
  (id.includes('dust') && id.includes('wood'))

const isCloth = (id: string): boolean => id === 'wool' || id === 'cloth' || id.includes('silk')

const isGem = (id: string): boolean =>
  id.includes('gem') ||
  id.includes('ruby') ||
  id.includes('emerald') ||
  id.includes('sapphire') ||
  id.includes('dust')
