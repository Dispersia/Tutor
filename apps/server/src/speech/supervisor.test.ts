import { expect, test } from 'bun:test'
import { SpeechSupervisor, shouldStopSpeech } from './supervisor'

test('shouldStopSpeech only when running, idle and no active streams', () => {
  expect(shouldStopSpeech({ running: true, idleMs: 1000, active: 0, timeoutMs: 500 })).toBe(true)
  expect(shouldStopSpeech({ running: false, idleMs: 9e9, active: 0, timeoutMs: 1 })).toBe(false)
  expect(shouldStopSpeech({ running: true, idleMs: 9e9, active: 1, timeoutMs: 1 })).toBe(false)
  expect(shouldStopSpeech({ running: true, idleMs: 100, active: 0, timeoutMs: 500 })).toBe(false)
})

test('activity tracking + idle accounting', () => {
  const sup = new SpeechSupervisor({
    url: 'http://127.0.0.1:1',
    port: 1,
    pythonDir: '.',
    modelsDir: '.',
    idleTimeoutMs: 1000,
    autostart: false,
  })
  expect(sup.activity().activeStreams).toBe(0)
  sup.begin()
  sup.begin()
  expect(sup.activity().activeStreams).toBe(2)
  expect(sup.idleMs()).toBeLessThan(50)
  sup.end()
  sup.end()
  sup.end()
  expect(sup.activity().activeStreams).toBe(0)
})

test('ensure() spawns once and stop() kills', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('{"ready":false,"models":[]}', { status: 200 })) as unknown as typeof fetch

  let spawned = 0
  let killed = false
  const sup = new SpeechSupervisor({
    url: 'http://127.0.0.1:9',
    port: 9,
    pythonDir: '.',
    modelsDir: '.',
    idleTimeoutMs: 600_000,
    autostart: false,
    spawn: () => {
      spawned++
      const proc = { pid: 123, exitCode: null as number | null, kill: () => void (killed = true) }
      return proc
    },
  })

  await sup.ensure()
  await sup.ensure()
  expect(spawned).toBe(1)
  expect(sup.running).toBe(true)

  await sup.stop()
  expect(killed).toBe(true)
  expect(sup.running).toBe(false)

  globalThis.fetch = orig
})

test('warm() spawns once and asks the gateway to load its models', async () => {
  const orig = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
    return new Response('{"ok":true,"models":["asr","align","tts_preset"]}', { status: 200 })
  }) as unknown as typeof fetch

  let spawned = 0
  const sup = new SpeechSupervisor({
    url: 'http://127.0.0.1:9',
    port: 9,
    pythonDir: '.',
    modelsDir: '.',
    idleTimeoutMs: 600_000,
    autostart: false,
    spawn: () => {
      spawned++
      return { pid: 1, exitCode: null as number | null, kill: () => undefined }
    },
  })

  await sup.warm()
  await sup.warm()
  expect(spawned).toBe(1)
  expect(calls.filter((c) => c === 'POST http://127.0.0.1:9/v1/warm').length).toBe(2)
  expect(sup.activity().activeStreams).toBe(0)

  globalThis.fetch = orig
})

test('ensure() surfaces a crashed gateway', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('refused')
  }) as unknown as typeof fetch

  const sup = new SpeechSupervisor({
    url: 'http://127.0.0.1:9',
    port: 9,
    pythonDir: '.',
    modelsDir: '.',
    idleTimeoutMs: 600_000,
    autostart: false,
    spawn: () => ({ pid: 1, exitCode: 1, kill: () => undefined }),
  })

  await expect(sup.ensure()).rejects.toThrow(/exited during startup/)
  globalThis.fetch = orig
})

const cfg = {
  url: 'http://127.0.0.1:9',
  port: 9,
  pythonDir: '.',
  modelsDir: '.',
  idleTimeoutMs: 600_000,
  autostart: false,
}

test('stop() waits for the exit, so an immediate ensure() cannot double-spawn', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('{"ready":false,"models":[]}', { status: 200 })) as unknown as typeof fetch

  let alive = 0
  let peak = 0
  const exits: (() => void)[] = []
  const sup = new SpeechSupervisor({
    ...cfg,
    spawn: () => {
      peak = Math.max(peak, ++alive)
      const proc = {
        pid: 7,
        exitCode: null as number | null,
        exited: new Promise<void>((resolve) => exits.push(resolve)),
        kill: () => undefined,
      }
      void proc.exited.then(() => void (alive--, (proc.exitCode = 0)))
      return proc
    },
  })

  await sup.ensure()
  const stopping = sup.stop()
  const restarting = sup.ensure()
  await Bun.sleep(20)
  expect(exits.length).toBe(1)
  exits[0]!()
  await stopping
  await restarting
  expect(exits.length).toBe(2)
  expect(peak).toBe(1)
  expect(sup.running).toBe(true)
  globalThis.fetch = orig
})

test('ensure() adopts a gateway that already answers instead of spawning', async () => {
  const orig = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
    return Response.json({ ready: true, models: ['asr'], idleTimeoutMs: 600_000 })
  }) as unknown as typeof fetch

  let spawned = 0
  const sup = new SpeechSupervisor({
    ...cfg,
    spawn: () => {
      spawned++
      return { pid: 1, exitCode: null as number | null, kill: () => undefined }
    },
  })

  await sup.ensure()
  await sup.ensure()
  expect(spawned).toBe(0)
  expect(sup.running).toBe(true)

  await sup.stop()
  expect(sup.running).toBe(false)
  expect(calls).toContain('POST http://127.0.0.1:9/admin/shutdown')
  globalThis.fetch = orig
})
