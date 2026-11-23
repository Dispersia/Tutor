import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createApp } from '../app'
import type { Deps } from '../context'
import { openDb } from '../db/client'
import { EventBus } from '../events'
import { OpenRouter } from '../llm/openrouter'
import { SpeechSupervisor } from '../speech/supervisor'
import { clearModelCatalogues } from './models'

let hits: string[] = []
let stub: { url: string; stop: () => void }

beforeAll(() => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      hits.push(`${new URL(req.url).pathname} ${req.headers.get('authorization') ?? '-'}`)
      return Response.json({
        data: [
          { id: 'b/model', name: 'B' },
          { id: 'a/model', name: 'A' },
        ].map((m) => ({
          ...m,
          pricing: {},
          architecture: { output_modalities: ['text'] },
        })),
      })
    },
  })
  stub = { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
})

afterAll(() => stub.stop())

function appWith(serverKey: string | undefined) {
  const { db } = openDb(':memory:')
  const deps: Deps = {
    db,
    or: new OpenRouter(serverKey, stub.url),
    supervisor: new SpeechSupervisor({
      url: 'http://127.0.0.1:1',
      port: 1,
      pythonDir: '.',
      modelsDir: '.',
      idleTimeoutMs: 600_000,
      autostart: false,
    }),
    defaults: { conversation: 'c', judge: 'j', generator: 'g', translator: 't' },
    serverKey,
    secret: undefined,
    allowRegistration: true,
    sessionTtlMs: 86_400_000,
    events: new EventBus(),
  }
  return createApp(deps, { staticDir: '/definitely/not/here', log: false })
}

const ids = async (app: ReturnType<typeof appWith>, query = '') =>
  (
    (await (await app.request(`/api/models${query}`)).json()) as { models: { id: string }[] }
  ).models.map((m) => m.id)

test('the catalogue is fetched once per base URL + key, not once per request', async () => {
  clearModelCatalogues()
  hits = []
  const app = appWith('key-one')
  expect(await ids(app)).toEqual(['a/model', 'b/model'])
  expect(await ids(app, '?q=b')).toEqual(['b/model'])
  // a filtered or sorted reply never changes what the next caller gets
  expect(await ids(app)).toEqual(['a/model', 'b/model'])
  // a second app (a fresh client per request is the normal case) shares the cache
  expect(await ids(appWith('key-one'))).toEqual(['a/model', 'b/model'])
  expect(hits).toEqual(['/models/user Bearer key-one'])

  // another key, or no key, is its own catalogue
  await ids(appWith('key-two'))
  await ids(appWith(undefined))
  expect(hits.slice(1)).toEqual(['/models/user Bearer key-two', '/models -'])
})
