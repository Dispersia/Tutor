/**
 * Item coin value and the Distill XP it prices (docs/DESIGN.md §13.5.3.2).
 */

import type { ItemDef } from './types'

/** An item's coin value: explicit when set, else derived from its kind and level. */
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

/**
 * Enchanting XP one coin of an item's value is worth when distilled (§13.5.3.2).
 *
 * The action curve costs **58,410 XP** to reach level 100 (`skillXpForLevel`), and
 * Enchanting should cap in **~10 days** of steady play. So the XP gain is priced at
 * `6 XP per coin`: distilling ~9,735 coins of value maxes it — about **975 coins a
 * day**. That keeps an endgame piece (≈100 coins) worth 600 XP, a real step but never
 * a free level, while junk still trickles in.
 */
export const DISTILL_XP_PER_VALUE = 6
