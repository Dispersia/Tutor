import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import {
  addGearSet,
  addItems,
  createUser,
  getItemCount,
  listEquipment,
  listGearInstances,
} from '../db/repo'
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
  ensureBaseGearInstance,
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

  const result = completeAction(db, bus, user.id, 'forge-bronze-helm')
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
  // worn gear stays in the inventory as "pieces owned"
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
  completeAction(db, bus, user.id, 'forge-bronze-helm')
  completeAction(db, bus, user.id, 'sew-leather-helm')

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
  completeAction(db, bus, user.id, 'forge-bronze-helm')

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
  ensureBaseGearInstance(db, user.id, ITEM_BY_ID.get('iron_sword')!)
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
