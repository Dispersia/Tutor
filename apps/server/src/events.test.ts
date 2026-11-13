import { expect, test } from 'bun:test'
import { EventBus, type GameEventMap } from './events'

test('subscribe, emit and unsubscribe', () => {
  const bus = new EventBus()
  const seen: GameEventMap['xp.awarded'][] = []
  const off = bus.on('xp.awarded', (e) => seen.push(e))
  bus.emit('xp.awarded', { userId: 'u', amount: 10, reason: 'review', total: 10 })
  expect(seen.length).toBe(1)
  expect(seen[0]!.total).toBe(10)
  off()
  bus.emit('xp.awarded', { userId: 'u', amount: 5, reason: 'review', total: 15 })
  expect(seen.length).toBe(1)
})

test('a failing handler does not break others', () => {
  const bus = new EventBus()
  let reached = false
  bus.on('level.up', () => {
    throw new Error('boom')
  })
  bus.on('level.up', () => {
    reached = true
  })
  bus.emit('level.up', { userId: 'u', level: 2 })
  expect(reached).toBe(true)
  expect(bus.handlerCount('level.up')).toBe(2)
})
