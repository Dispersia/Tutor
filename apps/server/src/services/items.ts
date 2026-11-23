/** Granting and consuming materials (docs/DESIGN.md §13.5). */

import { addItems, getItemCount } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { applyYield } from '../game/modifiers'
import { type Cost } from '../game/skills'
import { recordGearCrafts } from './gearInstances'
import { aggregateBonuses } from './progress'

/** Grants materials, applying the action's own yield + double bonuses. */
export function grantItems(
  db: Db,
  bus: EventBus,
  userId: string,
  actionId: string,
  costs: Cost[],
  rand: () => number = Math.random,
): Cost[] {
  const bonus = aggregateBonuses(db, userId)
  const granted: Cost[] = []
  for (const c of costs) {
    const count = applyYield(c.count, bonus.yield(actionId), bonus.double(actionId), rand)
    if (count <= 0) continue
    addItems(db, userId, c.item, count)
    recordGearCrafts(db, userId, c.item, count, rand)
    granted.push({ item: c.item, count })
    bus.emit('item.gained', {
      userId,
      itemId: c.item,
      count,
      total: getItemCount(db, userId, c.item),
    })
  }
  return granted
}

export function consumeItems(db: Db, bus: EventBus, userId: string, costs: Cost[]): void {
  for (const c of costs) {
    addItems(db, userId, c.item, -c.count)
    bus.emit('item.consumed', {
      userId,
      itemId: c.item,
      count: c.count,
      total: getItemCount(db, userId, c.item),
    })
  }
}

export function grantFixedItems(db: Db, bus: EventBus, userId: string, costs: Cost[]): void {
  for (const c of costs) {
    if (c.count <= 0) continue
    addItems(db, userId, c.item, c.count)
    recordGearCrafts(db, userId, c.item, c.count)
    bus.emit('item.gained', {
      userId,
      itemId: c.item,
      count: c.count,
      total: getItemCount(db, userId, c.item),
    })
  }
}
