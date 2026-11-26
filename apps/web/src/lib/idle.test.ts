import { expect, test } from 'bun:test'
import { rigGainedSince, rigGatheredTotal, rigRunLengthSec } from './idle'
import type { IdleRigDTO } from './skills'

function rig(over: Partial<IdleRigDTO> = {}): IdleRigDTO {
  return {
    actionId: 'mine',
    completions: 1,
    active: true,
    runEndsAt: 0,
    runStartedAt: 0,
    secondsLeft: 0,
    runSec: 600,
    maxRunSec: 10800,
    runFullAtCompletions: 25,
    runProgress: 0.04,
    maxed: false,
    intervalSec: 20,
    crafts: 0,
    xpPerCraft: 0.9,
    produces: [{ item: 'ore', count: 1, multiplier: 1, remainder: 0 }],
    consumes: [],
    ...over,
  }
}

test('rigGatheredTotal counts from the start of the run, not from the page load', () => {
  const now = 1_000_000
  const r = rig({ runEndsAt: now + 540_000, runSec: 600 })
  expect(rigGatheredTotal(r, now)).toEqual({ ore: 3 })
  expect(rigGatheredTotal(r, now + 60_000)).toEqual({ ore: 6 })
})

test('rigGatheredTotal counts from the recorded run start, not the run capacity', () => {
  const now = 1_000_000
  const r = rig({ runEndsAt: now + 540_000, runSec: 600, runStartedAt: now - 60_000 })
  expect(rigGatheredTotal(r, now)).toEqual({ ore: 3 })
})

test('rigGatheredTotal applies the per-item produce multiplier', () => {
  const now = 1_000_000
  const produces = [{ item: 'ore', count: 1, multiplier: 1.5, remainder: 0 }]
  const r = rig({ runEndsAt: now + 540_000, runSec: 600, produces })
  expect(rigGatheredTotal(r, now)).toEqual({ ore: 4 })
})

test('rigGatheredTotal folds in the carried remainder, so it reads the settled number', () => {
  const now = 1_000_000
  const produces = [{ item: 'ore', count: 1, multiplier: 1.5, remainder: 0.5 }]
  const r = rig({ runEndsAt: now + 540_000, runSec: 600, produces })
  expect(rigGatheredTotal(r, now)).toEqual({ ore: 5 })
})

test('the client total matches the settle arithmetic for the same rig state', () => {
  const now = 1_000_000
  const successChance = 0.8
  const yieldBonus = 0.5
  const crafts = 7
  const produces = [
    { item: 'ore', count: 1, multiplier: successChance * (1 + yieldBonus), remainder: 0.4 },
    {
      item: 'coins',
      count: 2,
      multiplier: successChance * (1 + yieldBonus) + 0.25,
      remainder: 0.1,
    },
  ]
  const r = rig({
    runEndsAt: now + 100_000,
    runStartedAt: now - crafts * 20_000,
    produces,
  })
  const settled = {
    ore: Math.floor(crafts * 1 * (successChance * (1 + yieldBonus)) + 0.4),
    coins: Math.floor(crafts * 2 * (successChance * (1 + yieldBonus) + 0.25) + 0.1),
  }
  expect(rigGatheredTotal(r, now)).toEqual(settled)
})

test('rigGainedSince continues from the carried craft fraction', () => {
  const now = 1_000_000
  const r = rig({ runEndsAt: now + 100_000, crafts: 0.75 })
  expect(rigGainedSince(r, now, now + 30_000)).toEqual({ ore: 2 })
})

test('rigGatheredTotal ignores still rigs', () => {
  const now = 1_000_000
  expect(rigGatheredTotal(rig({ active: false }), now)).toEqual({})
})

test('rigRunLengthSec reads the run itself, not the lifetime capacity', () => {
  const now = 1_000_000
  expect(rigRunLengthSec(rig({ runEndsAt: now + 420_000, runSec: 10800, runStartedAt: now }))).toBe(
    420,
  )
  expect(
    rigRunLengthSec(rig({ runEndsAt: now + 540_000, runSec: 10800, runStartedAt: now - 60_000 })),
  ).toBe(600)
})

test('rigRunLengthSec falls back to the capacity when the start is unknown', () => {
  const now = 1_000_000
  expect(rigRunLengthSec(rig({ runEndsAt: now + 540_000, runSec: 600 }))).toBe(600)
  expect(rigRunLengthSec(rig({ runEndsAt: now + 540_000, runSec: 10800 }))).toBe(10800)
})
