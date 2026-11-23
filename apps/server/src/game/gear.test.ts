import type { UserId } from '../ids'
import { expect, test } from 'bun:test'
import { openDb, type Db } from '../db/client'
import {
  addGearSet,
  addItems,
  createUser,
  getItemCount,
  listEquipment,
  listGearInstances,
  spendableCount,
} from '../db/repo'
import { equipment, inventory } from '../db/schema'
import { EventBus } from '../events'
import { MONSTERS, MONSTER_BY_ID } from './combat'
import { ITEM_BY_ID } from './skills'
import {
  EMPTY_STATS,
  QUALITY_MULTIPLIER,
  itemRequirements,
  meetsRequirements,
  requiredLevelFor,
  rollGearStats,
} from './gear'
import {
  applyGearSet,
  backfillGearInstances,
  consumeItems,
  grantFixedItems,
  discardGear,
  distillItem,
  inventoryView,
  settleRigs,
  completeAction,
  equipItem,
  gearSetsView,
  gearView,
  loadPlayerCombat,
  salvageGear,
  saveGearSet,
  unequipItem,
} from '../services'

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'gear', passwordHash: 'x' })
  return { db, sqlite, user, bus: new EventBus() }
}

/** Deterministic PRNG so a roll is reproducible in tests. */
function seeded(seed = 42) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

test('crafted gear rolls quality and affixes deterministically', () => {
  const item = ITEM_BY_ID.get('bronze_helm')!
  const roll = rollGearStats(item, seeded())
  expect(['common', 'uncommon', 'rare', 'epic']).toContain(roll.quality)
  expect(roll.stats.stamina).toBeGreaterThanOrEqual(1)
  // base stats are scaled by the quality multiplier
  expect(roll.stats.stamina).toBeGreaterThanOrEqual(
    Math.round((item.stats?.stamina ?? 0) * QUALITY_MULTIPLIER[roll.quality]),
  )
  // at least one affix landed on top of the base
  expect(roll.stats).not.toEqual(EMPTY_STATS)
})

test('a craft creates a gear instance and equipping keeps the stack count', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_bar', 20)

  const result = completeAction(db, bus, user.id, { actionId: 'forge-bronze-helm' })
  expect(result.gained).toEqual([{ item: 'bronze_helm', count: 1 }])

  const gear = listGearInstances(db, user.id)
  expect(gear).toHaveLength(1)
  expect(gear[0]!.itemId).toBe('bronze_helm')
  expect(gear[0]!.slot).toBe('head')
  expect(gear[0]!.quality).not.toBe('')

  const res = equipItem(db, bus, user.id, 'bronze_helm')
  expect(res.ok).toBe(true)
  expect(listEquipment(db, user.id)).toHaveLength(1)
  expect(listEquipment(db, user.id)[0]!.slot).toBe('head')
  // worn gear is still a piece owned: the count is the number of instances
  expect(getItemCount(db, user.id, 'bronze_helm')).toBe(1)

  const pc = loadPlayerCombat(db, user.id)
  expect(pc.armour).toBeGreaterThan(0)
  expect(pc.stats.stamina).toBeGreaterThan(0)
  expect(pc.gearScore).toBeGreaterThan(0)
  sqlite.close()
})

test('saved gear sets swap the whole loadout', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_bar', 40)
  addItems(db, user.id, 'leather', 20)
  completeAction(db, bus, user.id, { actionId: 'forge-bronze-helm' })
  completeAction(db, bus, user.id, { actionId: 'sew-leather-helm' })

  equipItem(db, bus, user.id, 'bronze_helm')
  const set = saveGearSet(db, user.id, 'Melee')
  expect(set.slots.head).toBeTruthy()

  unequipItem(db, user.id, 'head')
  expect(listEquipment(db, user.id)).toHaveLength(0)

  const applied = applyGearSet(db, bus, user.id, set.id)
  expect(applied.ok).toBe(true)
  expect(listEquipment(db, user.id)[0]!.itemId).toBe('bronze_helm')
  expect(gearSetsView(db, user.id)).toHaveLength(1)
  sqlite.close()
})

test('monsters are fixed and ordered as a ladder (§13.5.3)', () => {
  // No scaling: a monster's numbers are constant whatever your gear or level, so a
  // buff you stack reads as power instead of being cancelled out.
  const slime = MONSTER_BY_ID.get('slime')!
  expect(slime.hp).toBeGreaterThan(0)
  // The ladder runs weakest → strongest (by hp), so there is always a harder fight.
  for (let i = 1; i < MONSTERS.length; i++) {
    expect(MONSTERS[i]!.level).toBeGreaterThanOrEqual(MONSTERS[i - 1]!.level)
    expect(MONSTERS[i]!.hp).toBeGreaterThan(MONSTERS[i - 1]!.hp)
  }
})

test('wearing two pieces of one armour family activates its set bonus', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_helm', 1)
  addItems(db, user.id, 'bronze_chest', 1)
  equipItem(db, bus, user.id, 'bronze_helm')
  equipItem(db, bus, user.id, 'bronze_chest')

  const pc = loadPlayerCombat(db, user.id)
  const vanguard = pc.setBonuses.find((set) => set.id === 'vanguard')
  expect(vanguard?.pieces).toBe(2)
  expect(vanguard?.active.map((tier) => tier.pieces)).toContain(2)
  expect(vanguard?.next?.pieces).toBe(4)
  sqlite.close()
})

test('salvaging a piece returns its crafting material', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_bar', 20)
  completeAction(db, bus, user.id, { actionId: 'forge-bronze-helm' })

  const piece = listGearInstances(db, user.id)[0]!
  const res = salvageGear(db, bus, user.id, piece.id)
  expect(res.ok).toBe(true)
  expect(res.materials?.[0]?.item).toBe('iron_ore')
  expect(res.materials?.[0]?.count).toBeGreaterThan(0)
  expect(getItemCount(db, user.id, 'iron_ore')).toBeGreaterThan(0)
  expect(listGearInstances(db, user.id)).toHaveLength(0)
  sqlite.close()
})

test('gear requirements follow the slot and combat style', () => {
  expect(itemRequirements(ITEM_BY_ID.get('bronze_sword')!)).toEqual({ attack: 1 })
  expect(itemRequirements(ITEM_BY_ID.get('iron_sword')!)).toEqual({ attack: 5 })
  expect(itemRequirements(ITEM_BY_ID.get('willow_longbow')!)).toEqual({ ranged: 5 })
  expect(itemRequirements(ITEM_BY_ID.get('oak_staff')!)).toEqual({ magic: 1 })
  expect(itemRequirements(ITEM_BY_ID.get('steel_platebody')!)).toEqual({ defence: 10 })
  expect(itemRequirements(ITEM_BY_ID.get('bronze_shield')!)).toEqual({ defence: 1 })
  expect(itemRequirements(ITEM_BY_ID.get('leather_quiver')!)).toEqual({ ranged: 1 })
  expect(itemRequirements(ITEM_BY_ID.get('cloth_tome')!)).toEqual({ magic: 1 })
  // Jewellery is not stat-gated.
  expect(itemRequirements(ITEM_BY_ID.get('ring_ruby1')!)).toEqual({})

  // Bronze is wearable from the start; adamant demands level 30.
  expect(requiredLevelFor(1)).toBe(1)
  expect(requiredLevelFor(5)).toBe(30)
  expect(requiredLevelFor(9)).toBe(45)
})

test('equipping gear checks the combat stats it needs', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'iron_sword', 1)
  const res = equipItem(db, bus, user.id, 'iron_sword')
  expect(res.ok).toBe(false)
  expect(res.error).toContain('Attack 5')
  expect(res.missing?.[0]).toMatchObject({ skill: 'attack', level: 5, current: 1 })

  // Bronze is wearable from the start.
  addItems(db, user.id, 'bronze_sword', 1)
  expect(equipItem(db, bus, user.id, 'bronze_sword').ok).toBe(true)

  // A locked piece still shows in the inventory, with what it needs.
  const piece = gearView(db, user.id).find((g) => g.itemId === 'iron_sword')
  expect(piece?.missing[0]).toMatchObject({ skill: 'attack', name: 'Attack', level: 5 })
  expect(meetsRequirements(ITEM_BY_ID.get('iron_sword')!, () => 5).ok).toBe(true)
  sqlite.close()
})

test('wearing a saved set skips pieces you cannot use yet', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'iron_helm', 1)
  const setId = addGearSet(db, {
    userId: user.id,
    name: 'Locked',
    combatStyle: 'melee',
    slotsJson: JSON.stringify({ head: { itemId: 'iron_helm', instanceId: null } }),
  })
  const res = applyGearSet(db, bus, user.id, setId)
  expect(res.ok).toBe(true)
  expect(res.skipped).toHaveLength(1)
  expect(res.skipped[0]).toMatchObject({ slot: 'head', itemId: 'iron_helm', name: 'Iron helm' })
  expect(listEquipment(db, user.id)).toHaveLength(0)
  sqlite.close()
})

// --- gear instances are the only record of equipment (§13.5.3) -----------------

/** What the bank reports for an item, and how many pieces really exist. */
function owned(db: Db, userId: UserId, itemId: string) {
  return {
    count: getItemCount(db, userId, itemId),
    listed: inventoryView(db, userId).find((i) => i.itemId === itemId)?.count,
    pieces: listGearInstances(db, userId).filter((g) => g.itemId === itemId).length,
  }
}

const all = (n: number) => ({ count: n, listed: n, pieces: n })

test('a granted piece is an instance: the count is the number of instances', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_helm', 2)
  grantFixedItems(db, bus, user.id, [{ item: 'bronze_helm', count: 1 }])
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(3))
  // nothing is written to the materials table for equipment
  expect(db.select().from(inventory).all()).toEqual([])
  sqlite.close()
})

test('equipping and unequipping never change how many pieces are owned', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_helm', 2)
  expect(equipItem(db, bus, user.id, 'bronze_helm').ok).toBe(true)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(2))
  unequipItem(db, user.id, 'head')
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(2))
  sqlite.close()
})

test('discard, salvage and distill each take one piece and one off the count', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_helm', 4)
  const [a, b] = listGearInstances(db, user.id)
  expect(discardGear(db, user.id, a!.id).ok).toBe(true)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(3))
  expect(salvageGear(db, bus, user.id, b!.id).ok).toBe(true)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(2))
  expect(distillItem(db, bus, user.id, 'bronze_helm').ok).toBe(true)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(1))

  // the last piece is worn: it cannot be distilled, and nothing is lost trying
  equipItem(db, bus, user.id, 'bronze_helm')
  expect(distillItem(db, bus, user.id, 'bronze_helm').ok).toBe(false)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(1))
  sqlite.close()
})

test('a rig that forges equipment produces instances', () => {
  const { db, sqlite, user, bus } = setup()
  const t0 = 2_000_000_000_000
  addItems(db, user.id, 'bronze_bar', 200)
  completeAction(db, bus, user.id, { actionId: 'forge-bronze-helm', now: t0 })
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(1))

  const report = settleRigs(db, bus, user.id, t0 + 10 * 60_000)
  const forged = report.gained.find((g) => g.item === 'bronze_helm')?.count ?? 0
  expect(forged).toBeGreaterThan(0)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(1 + forged))
  sqlite.close()
})

test('a recipe that consumes equipment removes the piece', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'mythril_sword', 2)
  consumeItems(db, bus, user.id, [{ item: 'mythril_sword', count: 1 }])
  expect(owned(db, user.id, 'mythril_sword')).toEqual(all(1))
  sqlite.close()
})

test('a piece being worn is never spent, only spare ones', () => {
  const { db, sqlite, user, bus } = setup()
  addItems(db, user.id, 'bronze_sword', 1)
  expect(equipItem(db, bus, user.id, 'bronze_sword').ok).toBe(true)
  // owned, but nothing to spend: a recipe cannot take the sword off your hand
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)
  expect(spendableCount(db, user.id, 'bronze_sword')).toBe(0)
  consumeItems(db, bus, user.id, [{ item: 'bronze_sword', count: 1 }])
  expect(getItemCount(db, user.id, 'bronze_sword')).toBe(1)
  expect(listEquipment(db, user.id).length).toBe(1)
  sqlite.close()
})

test('the backfill turns a legacy stack into instances, once', () => {
  const { db, sqlite, user } = setup()
  const stamp = { userId: user.id, updatedAt: 1 }
  db.insert(inventory)
    .values([
      { ...stamp, itemId: 'bronze_helm', count: 2 },
      { ...stamp, itemId: 'bronze_sword', count: 1 },
      { ...stamp, itemId: 'copper_ore', count: 5 },
    ])
    .run()
  // a worn row from before instances: no piece behind it
  db.insert(equipment)
    .values({ ...stamp, slot: 'mainHand', itemId: 'bronze_sword', instanceId: null })
    .run()
  // until the backfill runs, the bank reports only real pieces
  expect(getItemCount(db, user.id, 'bronze_helm')).toBe(0)

  expect(backfillGearInstances(db)).toBe(3)
  expect(owned(db, user.id, 'bronze_helm')).toEqual(all(2))
  expect(owned(db, user.id, 'bronze_sword')).toEqual(all(1))
  const helm = listGearInstances(db, user.id).find((g) => g.itemId === 'bronze_helm')!
  expect(helm.quality).toBe('common')
  expect(helm.armour).toBe(ITEM_BY_ID.get('bronze_helm')!.armour ?? 0)
  const sword = listGearInstances(db, user.id).find((g) => g.itemId === 'bronze_sword')!
  expect(listEquipment(db, user.id)[0]!.instanceId).toBe(sword.id)
  // only materials are left in the stacks table
  expect(db.select().from(inventory).all()).toEqual([
    expect.objectContaining({ itemId: 'copper_ore', count: 5 }),
  ])

  expect(backfillGearInstances(db)).toBe(0)
  expect(listGearInstances(db, user.id)).toHaveLength(3)
  sqlite.close()
})
