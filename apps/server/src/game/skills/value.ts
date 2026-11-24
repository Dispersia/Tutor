import type { ItemDef } from './types'

export function itemValue(item: ItemDef): number {
  if (item.value !== undefined) return item.value
  switch (item.tier) {
    case 'raw':
      return 2
    case 'refined':
      return 8
    case 'consumable':
      return 6
    case 'equipment':
      return 20 * Math.max(1, item.itemLevel ?? 1)
    default:
      return 1
  }
}

export const DISTILL_XP_PER_VALUE = 9
