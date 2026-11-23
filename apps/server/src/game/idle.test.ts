import { describe, expect, test } from 'bun:test'
import {
  IDLE,
  MAX_LIVE_RIGS,
  capLiveRigs,
  extendRig,
  liveRigCount,
  newRig,
  replayRig,
  rigIntervalSec,
  rigMaxed,
  rigRunProgress,
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
    expect(rigIntervalSec(0)).toBe(10)
    expect(rigIntervalSec(15)).toBeCloseTo(6, 6)
    expect(rigIntervalSec(60)).toBeCloseTo(2.5, 6)
    // never below the floor, monotone
    for (const c of [0, 1, 5, 30, 120, 1000]) expect(rigIntervalSec(c)).toBeGreaterThanOrEqual(2)
    expect(rigIntervalSec(500)).toBeCloseTo(IDLE.floorIntervalSec, 3)
  })

  test('run length climbs evenly from 10 min to 3 h at 50 completions', () => {
    expect(rigRunSec(0)).toBe(600)
    expect(rigRunSec(1)).toBe(600)
    expect(rigRunSec(IDLE.runFullAtCompletions)).toBeCloseTo(IDLE.maxRunSec, 6)

    // 50 completions = 3 hours, and every step before it is the same size.
    const step = rigRunSec(2) - rigRunSec(1)
    expect(step).toBeCloseTo((IDLE.maxRunSec - IDLE.firstRunSec) / 49, 6)
    for (let c = 1; c < IDLE.runFullAtCompletions; c++) {
      expect(rigRunSec(c + 1) - rigRunSec(c)).toBeCloseTo(step, 6)
    }

    // saturates at the ceiling and never exceeds it
    expect(rigRunSec(10_000)).toBe(IDLE.maxRunSec)
    expect(rigRunSec(IDLE.runFullAtCompletions + 1)).toBe(IDLE.maxRunSec)
  })

  test('run progress climbs to 1 at the cap and maxed flips exactly there', () => {
    expect(rigRunProgress(0)).toBe(0)
    expect(rigRunProgress(IDLE.runFullAtCompletions / 2)).toBeCloseTo(0.5, 6)
    expect(rigRunProgress(IDLE.runFullAtCompletions)).toBe(1)
    // clamped: beyond the cap it stays 1
    expect(rigRunProgress(10_000)).toBe(1)

    expect(rigMaxed(0)).toBe(false)
    expect(rigMaxed(IDLE.runFullAtCompletions - 1)).toBe(false)
    expect(rigMaxed(IDLE.runFullAtCompletions)).toBe(true)
    expect(rigMaxed(10_000)).toBe(true)
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

  test('the run is re-based on the count, never stacked', () => {
    // 50 drills at the same instant reach the 3 h ceiling exactly — no more.
    let rig = newRig()
    for (let i = 0; i < 50; i++) rig = extendRig(rig, 1_000)
    expect(rig.runEndsAt).toBe(1_000 + IDLE.maxRunSec * 1000)
    const past = extendRig(rig, 1_000)
    expect(past.runEndsAt).toBe(1_000 + IDLE.maxRunSec * 1000)

    // 10 completions buy ~40 min, not the ceiling: the old sum hit 3 h here.
    let ten = newRig()
    for (let i = 0; i < 10; i++) ten = extendRig(ten, 1_000)
    expect(ten.runEndsAt).toBe(1_000 + Math.round(rigRunSec(10) * 1000))
    expect(ten.runEndsAt).toBeLessThan(1_000 + IDLE.maxRunSec * 1000)

    // Two quick drills = one `rigRunSec(2)` run from the last drill, not
    // `rigRunSec(1) + rigRunSec(2)`.
    let two = extendRig(newRig(), 1_000)
    two = extendRig(two, 2_000)
    expect(two.runEndsAt).toBe(2_000 + Math.round(rigRunSec(2) * 1000))
  })

  test('an artisan consumes stock and is clamped by the bank', () => {
    const forge = extendRig(newRig(), 0)
    // empty bank → starved, nothing made, nothing eaten
    const starved = settleRig(forge, BAR, new Map(), forge.runEndsAt - 1)
    expect(starved.produced).toEqual({})
    expect(starved.consumed).toEqual({})

    // 4 ore in the bank → at most 4 bars, and the ore is spent
    const bank = new Map([['copper_ore', 4]])
    const fed = settleRig(forge, BAR, bank, forge.runEndsAt - 1)
    expect(fed.produced.bronze_bar).toBe(4)
    expect(fed.consumed.copper_ore).toBe(4)
    expect(bank.get('copper_ore')).toBe(0)
  })

  test('yield and double fold into the run as expected value', () => {
    const powered = extendRig(newRig(), 0)
    const plain = settleRig(powered, ORE, new Map(), 600_000)
    const rich = settleRig(powered, { ...ORE, yieldBonus: 1, doubleBonus: 0 }, new Map(), 600_000)
    expect(rich.produced.copper_ore).toBeGreaterThan(plain.produced.copper_ore!)
    expect(rich.produced.copper_ore).toBeCloseTo(plain.produced.copper_ore! * 2, 0)
  })

  test('reports the crafts the run completed on its own (the passive-XP basis)', () => {
    const powered = extendRig(newRig(), 0)
    const r = settleRig(powered, ORE, new Map(), 600_000)
    // one item per craft here, so the craft count is the item count
    expect(r.crafted).toBe(r.produced.copper_ore!)
    expect(r.crafted).toBeGreaterThan(0)

    // a still rig, and a starved artisan, craft nothing
    expect(settleRig(newRig(), ORE, new Map(), 10 ** 9).crafted).toBe(0)
    expect(settleRig(extendRig(newRig(), 0), BAR, new Map(), 1_000_000).crafted).toBe(0)
  })
})

describe('determinism', () => {
  test('the completion log alone reconstructs the bank', () => {
    // The contract docs/DESIGN.md §13.5.1 rests on: "just recording when things are
    // completed tells you how many resources they gained in a set amount of time."
    const times = [0, 2_000, 5_000, 20_000, 61_000]
    let live = newRig()
    const liveTotal: Record<string, number> = {}
    for (const t of times) {
      const settled = settleRig(live, ORE, new Map(), t)
      liveTotal.copper_ore = (liveTotal.copper_ore ?? 0) + (settled.produced.copper_ore ?? 0)
      live = extendRig(settled.state, t)
    }
    const tail = settleRig(live, ORE, new Map(), 900_000)
    liveTotal.copper_ore = (liveTotal.copper_ore ?? 0) + (tail.produced.copper_ore ?? 0)

    const replayed = replayRig(times, ORE, 900_000)
    expect(replayed.produced.copper_ore).toBe(liveTotal.copper_ore)
    expect(replayed.state.completions).toBe(times.length)
  })

  test('replay is order-independent over the log', () => {
    const a = replayRig([0, 5_000, 9_000], ORE, 600_000)
    const b = replayRig([9_000, 0, 5_000], ORE, 600_000)
    expect(a.produced).toEqual(b.produced)
  })

  test('the log alone also reconstructs the crafts (so passive XP replays)', () => {
    const times = [0, 2_000, 5_000, 20_000, 61_000]
    let live = newRig()
    let crafted = 0
    for (const t of times) {
      const settled = settleRig(live, ORE, new Map(), t)
      crafted += settled.crafted
      live = extendRig(settled.state, t)
    }
    crafted += settleRig(live, ORE, new Map(), 900_000).crafted
    expect(replayRig(times, ORE, 900_000).crafted).toBe(crafted)
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
    // The drill's own machine must always start, so it is never the one cut.
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
