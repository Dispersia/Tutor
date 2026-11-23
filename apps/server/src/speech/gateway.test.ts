import { expect, test } from 'bun:test'
import { withGateway, type GatewayHandle } from './gateway'

function handle(log: string[]): GatewayHandle {
  return {
    url: 'http://gw',
    ensure: async () => void log.push('ensure'),
    begin: () => void log.push('begin'),
    end: () => void log.push('end'),
  }
}

test('withGateway starts the gateway, holds it busy for the call, then releases it', async () => {
  const log: string[] = []
  const out = await withGateway(handle(log), async (url) => {
    log.push(`call ${url}`)
    return 42
  })
  expect(out).toBe(42)
  expect(log).toEqual(['ensure', 'begin', 'call http://gw', 'end'])
})

test('withGateway releases the gateway when the call throws', async () => {
  const log: string[] = []
  const failing = withGateway(handle(log), async () => {
    throw new Error('boom')
  })
  await expect(failing).rejects.toThrow('boom')
  expect(log).toEqual(['ensure', 'begin', 'end'])
})

test('withGateway does not mark the gateway busy when it cannot start', async () => {
  const log: string[] = []
  const sup = { ...handle(log), ensure: () => Promise.reject(new Error('down')) }
  await expect(withGateway(sup, async () => 1)).rejects.toThrow('down')
  expect(log).toEqual([])
})
