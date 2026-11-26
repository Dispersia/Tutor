import { MONSTERS } from './combat'
import { ACTIONS } from './skills/actions.data'
import { ENCHANTS } from './skills/enchants'
import { ESSENCES, essenceFamily, essenceId } from './skills/essences'
import { ITEM_BY_ID, SKILL_BY_ID } from './skills/lookups'
import { itemValue } from './skills/value'
import type { ActionDef, Cost, ItemDef, SkillId } from './skills/types'

interface ItemUse {
  kind: 'action' | 'enchant'
  skillId: SkillId
  skillName: string
  actionId: string
  name: string
  count: number
}

interface ItemSource {
  kind: 'action' | 'monster'
  name: string
  icon: string
  skillId?: SkillId
  skillName?: string
  actionId?: string
  monsterId?: string
  chance?: number
}

export interface ItemDetail {
  item: ItemDef & { value: number }
  usedIn: ItemUse[]
  sources: ItemSource[]
  essence: { id: string; name: string; icon: string }
}

const uses = new Map<string, ItemUse[]>()
const sources = new Map<string, ItemSource[]>()
let built = false

function addUse(item: string, use: ItemUse) {
  const list = uses.get(item)
  if (list) list.push(use)
  else uses.set(item, [use])
}

function addSource(item: string, source: ItemSource) {
  const list = sources.get(item)
  if (list) list.push(source)
  else sources.set(item, [source])
}

function actionUse(action: ActionDef, cost: Cost, name: string): ItemUse {
  return {
    kind: 'action',
    skillId: action.skillId,
    skillName: SKILL_BY_ID.get(action.skillId)?.name ?? action.skillId,
    actionId: action.id,
    name,
    count: cost.count,
  }
}

function actionSource(action: ActionDef, name: string): ItemSource {
  return {
    kind: 'action',
    name,
    icon: SKILL_BY_ID.get(action.skillId)?.icon ?? '•',
    skillId: action.skillId,
    skillName: SKILL_BY_ID.get(action.skillId)?.name ?? action.skillId,
    actionId: action.id,
  }
}

function addConsumes(action: ActionDef, name: string) {
  for (const cost of action.consumes ?? []) addUse(cost.item, actionUse(action, cost, name))
}

function addProduces(action: ActionDef, name: string) {
  for (const cost of action.produces ?? []) addSource(cost.item, actionSource(action, name))
}

function addTable(action: ActionDef, name: string) {
  for (const entry of action.table ?? []) addSource(entry.item, actionSource(action, name))
}

function buildAction(action: ActionDef) {
  addConsumes(action, action.name)
  addProduces(action, action.name)
  addTable(action, action.name)
  for (const choice of action.choices ?? []) {
    const name = `${action.name} · ${choice.label}`
    for (const cost of choice.consumes ?? []) addUse(cost.item, actionUse(action, cost, name))
    for (const cost of choice.produces ?? []) addSource(cost.item, actionSource(action, name))
    for (const entry of choice.table ?? []) addSource(entry.item, actionSource(action, name))
  }
}

function buildEnchants() {
  for (const enchant of ENCHANTS) {
    for (const cost of enchant.reagents) {
      addUse(cost.item, {
        kind: 'enchant',
        skillId: 'enchanting',
        skillName: 'Enchanting',
        actionId: enchant.id,
        name: enchant.name,
        count: cost.count,
      })
    }
  }
}

function buildMonsters() {
  for (const monster of MONSTERS) {
    for (const drop of monster.drops) {
      addSource(drop.item, {
        kind: 'monster',
        name: monster.name,
        icon: monster.icon,
        monsterId: monster.id,
        chance: drop.chance,
      })
    }
  }
}

function buildEssences() {
  for (const essence of ESSENCES) {
    addSource(essenceId(essence.id), {
      kind: 'action',
      name: 'Distill',
      icon: '🔯',
      skillId: 'enchanting',
      skillName: 'Enchanting',
      actionId: 'distill',
    })
  }
}

function build() {
  if (built) return
  built = true
  for (const action of ACTIONS) buildAction(action)
  buildEnchants()
  buildMonsters()
  buildEssences()
}

function describe(item: ItemDef): string {
  if (item.description) return item.description
  if (item.tier === 'raw') return 'A raw material gathered from the world.'
  if (item.tier === 'refined') return 'A refined material used in crafting.'
  if (item.tier === 'consumable') return 'A consumable used in combat or crafting.'
  if (item.tier === 'equipment') return 'A piece of equipment.'
  if (item.tier === 'coin') return 'The currency of the realm.'
  return 'A curious item.'
}

function unique<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const id = key(row)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function itemDetail(id: string): ItemDetail | undefined {
  const item = ITEM_BY_ID.get(id)
  if (!item) return undefined
  build()
  const family = essenceFamily(item)
  const essence = ESSENCES.find((e) => e.id === family)
  return {
    item: { ...item, description: describe(item), value: itemValue(item) },
    usedIn: unique(uses.get(id) ?? [], (use) => `${use.kind}:${use.actionId}:${use.name}`),
    sources: unique(
      sources.get(id) ?? [],
      (source) => `${source.kind}:${source.actionId ?? source.monsterId}:${source.name}`,
    ),
    essence: {
      id: essence?.id ?? family,
      name: essence?.name ?? 'Essence',
      icon: essence?.icon ?? '✦',
    },
  }
}
