import { describe, expect, test } from 'bun:test'
import { idleProduces, rigYields } from '@tutor/core'
import {
  IDLE,
  MAX_LIVE_RIGS,
  capLiveRigs,
  extendRig,
  liveRigCount,
  newRig,
  rigIntervalSec,
  rigRunFill,
  rigRunFull,
  rigRunGainSec,
  rigRunSec,
  settleRig,
  type RigRecipe,
} from './idle'

const ORE: RigRecipe = { produces: [{ item: 'copper_ore', count: 1 }] }
const BAR: RigRecipe = {
  consumes: [{ item: 'copper_ore', count: 1 }],
  produces: [{ item: 'bronze_bar', count: 1 }],
}

describe('idle curves', () => {
  test('interval starts slow, speeds up and saturates at the floor', () => {
    expect(rigIntervalSec(0)).toBe(20)
    expect(rigIntervalSec(10)).toBeCloseTo(15, 6)
    expect(rigIntervalSec(50)).toBeCloseTo(10.3125, 6)
    for (const c of [0, 1, 5, 30, 120, 1000]) expect(rigIntervalSec(c)).toBeGreaterThanOrEqual(10)
    expect(rigIntervalSec(500)).toBeCloseTo(IDLE.floorIntervalSec, 3)
  })

  test('run length climbs evenly from 10 min to 3 h at the completion cap', () => {
    expect(rigRunSec(0)).toBe(600)
    expect(rigRunSec(1)).toBe(600)
    expect(rigRunSec(IDLE.runFullAtCompletions)).toBeCloseTo(IDLE.maxRunSec, 6)

    const step = rigRunSec(2) - rigRunSec(1)
    expect(step).toBeCloseTo(
      (IDLE.maxRunSec - IDLE.firstRunSec) / (IDLE.runFullAtCompletions - 1),
      6,
    )
    for (let c = 1; c < IDLE.runFullAtCompletions; c++) {
      expect(rigRunSec(c + 1) - rigRunSec(c)).toBeCloseTo(step, 6)
    }

    expect(rigRunSec(10_000)).toBe(IDLE.maxRunSec)
    expect(rigRunSec(IDLE.runFullAtCompletions + 1)).toBe(IDLE.maxRunSec)
  })

  test('the run fill climbs to 1 at the ceiling and full flips exactly there', () => {
    expect(rigRunFill(0)).toBe(0)
    expect(rigRunFill(IDLE.maxRunSec / 2)).toBeCloseTo(0.5, 6)
    expect(rigRunFill(IDLE.maxRunSec)).toBe(1)
    expect(rigRunFill(10 ** 9)).toBe(1)

    expect(rigRunFull(0)).toBe(false)
    expect(rigRunFull(IDLE.maxRunSec - 1)).toBe(false)
    expect(rigRunFull(IDLE.maxRunSec)).toBe(true)
    expect(rigRunFull(10 ** 9)).toBe(true)
  })

  test('deeper tiers run slower per item', () => {
    expect(rigIntervalSec(0, 5)).toBeCloseTo(rigIntervalSec(0, 1) * 2.4, 6)
    expect(rigIntervalSec(0, 5)).toBeGreaterThan(rigIntervalSec(0, 1))
    const t0 = extendRig(newRig(), 0)
    const tier1 = settleRig(t0, { ...ORE, tier: 1 }, new Map(), 600_000)
    const tier5 = settleRig(t0, { ...ORE, tier: 5 }, new Map(), 600_000)
    expect(tier5.produced.copper_ore!).toBeLessThan(tier1.produced.copper_ore!)
  })
})

describe('settleRig', () => {
  test('a still rig gains nothing, however long you wait', () => {
    const r = settleRig(newRig(), ORE, new Map(), 10 ** 9)
    expect(r.produced).toEqual({})
    expect(r.creditedSec).toBe(0)
    expect(r.running).toBe(false)
  })

  test('one completion starts a 10-minute 10-second run', () => {
    const powered = extendRig(newRig(), 0)
    expect(powered.completions).toBe(1)
    expect(powered.runEndsAt).toBe(Math.round(rigRunSec(1) * 1000))

    const at = powered.runEndsAt - 1000
    const r = settleRig(powered, ORE, new Map(), at)
    const wanted = (1 / rigIntervalSec(1)) * (at / 1000)
    expect(r.produced.copper_ore).toBe(Math.floor(wanted))
    expect(r.running).toBe(true)
  })

  test('credit is additive: two settles equal one (no timer drift)', () => {
    const powered = extendRig(newRig(), 0)
    const once = settleRig(powered, ORE, new Map(), 300_000)

    const half = settleRig(powered, ORE, new Map(), 150_000)
    const twice = settleRig(half.state, ORE, new Map(), 300_000)
    const split = (half.produced.copper_ore ?? 0) + (twice.produced.copper_ore ?? 0)
    expect(split).toBe(once.produced.copper_ore!)
    expect(twice.state.crafts).toBeCloseTo(once.state.crafts, 9)
  })

  test('nothing accrues past the end of the run', () => {
    const powered = extendRig(newRig(), 0)
    const end = powered.runEndsAt
    const settled = settleRig(powered, ORE, new Map(), end)
    const late = settleRig(settled.state, ORE, new Map(), end + 86_400_000)
    expect(late.produced).toEqual({})
    expect(late.creditedSec).toBe(0)
    expect(late.running).toBe(false)
  })

  test('more completions make the next run faster and longer', () => {
    const one = extendRig(newRig(), 0)
    let ten = newRig()
    for (let i = 0; i < 10; i++) ten = extendRig(settleRig(ten, ORE, new Map(), i).state, i)
    expect(rigIntervalSec(ten.completions)).toBeLessThan(rigIntervalSec(one.completions))
    expect(ten.runEndsAt).toBeGreaterThan(one.runEndsAt)
  })
})

describe('extendRig: the run climb', () => {
  test('a steady drill chain climbs one equal step to the ceiling', () => {
    let rig = newRig()
    for (let i = 0; i < 50; i++) rig = extendRig(rig, 1_000)
    expect(rig.runEndsAt).toBe(1_000 + IDLE.maxRunSec * 1000)
    const past = extendRig(rig, 1_000)
    expect(past.runEndsAt).toBe(1_000 + IDLE.maxRunSec * 1000)

    let ten = newRig()
    for (let i = 0; i < 10; i++) ten = extendRig(ten, 1_000)
    expect(ten.runEndsAt).toBe(1_000 + Math.round(rigRunSec(10) * 1000))
    expect(ten.runEndsAt).toBeLessThan(1_000 + IDLE.maxRunSec * 1000)
    expect(ten.runStartedAt).toBe(1_000)

    let two = extendRig(newRig(), 1_000)
    two = extendRig(two, 2_000)
    expect(two.runEndsAt).toBe(1_000 + Math.round(rigRunSec(2) * 1000))
  })

  test('topping up a drained run adds one step, never a fresh full run', () => {
    const step = rigRunGainSec(2)
    expect(step).toBeCloseTo(
      (IDLE.maxRunSec - IDLE.firstRunSec) / (IDLE.runFullAtCompletions - 1),
      6,
    )
    const drained = {
      ...newRig(),
      completions: IDLE.runFullAtCompletions,
      runEndsAt: 1_000 + 20 * 60 * 1000,
    }
    const topped = extendRig(drained, 1_000)
    expect(topped.completions).toBe(IDLE.runFullAtCompletions + 1)
    expect(topped.runEndsAt).toBe(1_000 + Math.round((20 * 60 + step) * 1000))
    expect(topped.runEndsAt).toBeLessThan(1_000 + IDLE.maxRunSec * 1000)
    expect(topped.runStartedAt).toBe(1_000)
  })

  test('a drill keeps the run start while the run is live and resets it when still', () => {
    const live = { ...newRig(), runEndsAt: 90_000, runStartedAt: 10_000 }
    expect(extendRig(live, 60_000).runStartedAt).toBe(10_000)
    const still = { ...newRig(), runEndsAt: 40_000, runStartedAt: 10_000 }
    expect(extendRig(still, 60_000).runStartedAt).toBe(60_000)
  })
})

describe('settleRig: stock and yield', () => {
  test('an artisan consumes stock and is clamped by the bank', () => {
    const forge = extendRig(newRig(), 0)
    const starved = settleRig(forge, BAR, new Map(), forge.runEndsAt - 1)
    expect(starved.produced).toEqual({})
    expect(starved.consumed).toEqual({})

    const bank = new Map([['copper_ore', 4]])
    const fed = settleRig(forge, BAR, bank, forge.runEndsAt - 1)
    expect(fed.produced.bronze_bar).toBe(4)
    expect(fed.consumed.copper_ore).toBe(4)
    expect(bank.get('copper_ore')).toBe(0)
  })

  test('yield folds into the run as expected value', () => {
    const powered = extendRig(newRig(), 0)
    const plain = settleRig(powered, ORE, new Map(), 600_000)
    const rich = settleRig(powered, { ...ORE, yieldBonus: 1 }, new Map(), 600_000)
    expect(rich.produced.copper_ore).toBeGreaterThan(plain.produced.copper_ore!)
    expect(rich.produced.copper_ore).toBeCloseTo(plain.produced.copper_ore! * 2, 0)
  })

  test('the client extrapolation agrees with the settle it is read from', () => {
    const recipe: RigRecipe = {
      produces: [{ item: 'copper_ore', count: 1 }],
      yieldBonus: 1,
      itemBonus: { copper_ore: 0.5 },
      successChance: 0.6,
    }
    const powered = extendRig(newRig(), 0)
    const now = powered.runEndsAt - 1
    const settle = settleRig(powered, recipe, new Map(), now)
    const interval = rigIntervalSec(powered.completions, recipe.tier ?? 1)
    const crafts = powered.crafts + (now - powered.settledAt) / 1000 / interval
    const client = idleProduces(crafts, rigYields(recipe.produces!, recipe, powered.remainder))
    expect(client.produced).toEqual(settle.produced)
    expect(client.remainder).toEqual(settle.state.remainder)
  })

  test('reports the crafts the run completed on its own (the passive-XP basis)', () => {
    const powered = extendRig(newRig(), 0)
    const r = settleRig(powered, ORE, new Map(), 600_000)
    expect(r.crafted).toBe(r.produced.copper_ore!)
    expect(r.crafted).toBeGreaterThan(0)

    expect(settleRig(newRig(), ORE, new Map(), 10 ** 9).crafted).toBe(0)
    expect(settleRig(extendRig(newRig(), 0), BAR, new Map(), 1_000_000).crafted).toBe(0)
  })
})

describe('live-rig cap', () => {
  const rig = (runEndsAt: number) => ({ ...newRig(), runEndsAt })

  test('nothing stops while at or under the cap', () => {
    const rigs = new Map([
      ['a', rig(1_000)],
      ['b', rig(2_000)],
    ])
    expect(MAX_LIVE_RIGS).toBe(2)
    expect(capLiveRigs(rigs, 0)).toEqual([])
    expect(rigs.get('a')!.runEndsAt).toBe(1_000)
    expect(rigs.get('b')!.runEndsAt).toBe(2_000)
  })

  test('a third live run stops the one closest to finishing', () => {
    const rigs = new Map([
      ['a', rig(1_000)],
      ['b', rig(5_000)],
      ['c', rig(9_000)],
    ])
    expect(capLiveRigs(rigs, 0)).toEqual(['a'])
    expect(rigs.get('a')!.runEndsAt).toBe(0)
    expect(rigs.get('b')!.runEndsAt).toBe(5_000)
    expect(rigs.get('c')!.runEndsAt).toBe(9_000)
  })

  test('a kept rig survives even when it is closest to finishing', () => {
    const rigs = new Map([
      ['a', rig(1_000)],
      ['b', rig(5_000)],
      ['c', rig(9_000)],
    ])
    expect(capLiveRigs(rigs, 0, ['a'])).toEqual(['b'])
    expect(rigs.get('a')!.runEndsAt).toBe(1_000)
    expect(rigs.get('b')!.runEndsAt).toBe(0)
  })

  test('still rigs are not live and never counted', () => {
    const rigs = new Map([
      ['a', rig(1_000)],
      ['b', rig(0)],
      ['c', rig(5_000)],
    ])
    expect(liveRigCount(rigs, 500)).toBe(2)
  })
})
