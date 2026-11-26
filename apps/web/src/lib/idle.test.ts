import { expect, test } from 'bun:test'
import { rigGatheredTotal, rigRunLengthSec } from './idle'
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
    produceMultiplier: 1,
    xpPerCraft: 0.9,
    produces: [{ item: 'ore', count: 1 }],
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

test('rigGatheredTotal applies the produce multiplier', () => {
  const now = 1_000_000
  const r = rig({ runEndsAt: now + 540_000, runSec: 600, produceMultiplier: 1.5 })
  expect(rigGatheredTotal(r, now)).toEqual({ ore: 4 })
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
