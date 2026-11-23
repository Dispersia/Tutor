import type { UserId } from '../ids'
import { addItems } from '../db/repo'
import type { Db } from '../db/client'
import type { EventBus } from '../events'
import { applyYield } from '../game/modifiers'
import { type Cost } from '../game/skills'
import { aggregateBonuses } from './progress'

export function grantItems(
  db: Db,
  bus: EventBus,
  userId: UserId,
  req: { actionId: string; costs: Cost[]; rand?: () => number },
): Cost[] {
  const bonus = aggregateBonuses(db, userId)
  const rand = req.rand ?? Math.random
  const granted: Cost[] = []
  for (const cost of req.costs) {
    const got = grantOne({ db, bus, userId, cost, bonus, actionId: req.actionId, rand })
    if (got) granted.push(got)
  }
  return granted
}

interface GrantReq {
  db: Db
  bus: EventBus
  userId: UserId
  cost: Cost
  bonus: ReturnType<typeof aggregateBonuses>
  actionId: string
  rand: () => number
}

function grantOne(req: GrantReq): Cost | undefined {
  const { db, bus, userId, cost } = req
  const count = applyYield(
    cost.count,
    req.bonus.yield(req.actionId) + (cost.item === 'coins' ? req.bonus.coins(req.actionId) : 0),
    req.bonus.double(req.actionId),
    req.rand,
  )
  if (count <= 0) return undefined
  addItems(db, userId, cost.item, count, req.rand)
  bus.emit('item.gained', { userId, itemId: cost.item, count })
  return { item: cost.item, count }
}

export function consumeItems(db: Db, bus: EventBus, userId: UserId, costs: Cost[]): void {
  for (const c of costs) {
    addItems(db, userId, c.item, -c.count)
    bus.emit('item.consumed', { userId, itemId: c.item, count: c.count })
  }
}

export function grantFixedItems(db: Db, bus: EventBus, userId: UserId, costs: Cost[]): void {
  for (const c of costs) {
    if (c.count <= 0) continue
    addItems(db, userId, c.item, c.count, Math.random)
    bus.emit('item.gained', { userId, itemId: c.item, count: c.count })
  }
}
