/** Pure derivations for the combat screen. No runes, no DOM. */

import type { ItemDTO, SkillsResponse } from './skills'

/** How much food and how many potions the player is carrying. */
export function countConsumables(
  inventory: SkillsResponse['inventory'],
  itemMap: Map<string, ItemDTO>,
): { food: number; potions: number } {
  let food = 0
  let potions = 0
  for (const row of inventory ?? []) {
    const item = itemMap.get(row.itemId)
    if (!item) continue
    if ((item.heal ?? 0) > 0) food += row.count
    if (item.buff) potions += row.count
  }
  return { food, potions }
}
