import type { ItemDTO } from '#lib/skills'

export function itemName(itemMap: Map<string, ItemDTO>, id: string): string {
  return itemMap.get(id)?.name ?? id
}

export function itemIcon(itemMap: Map<string, ItemDTO>, id: string): string {
  return itemMap.get(id)?.icon ?? ''
}
