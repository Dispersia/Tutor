import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../app'
import { createAudioService, type AudioService, type TtsRequest } from './service'
import { CARD_VOICES } from './voices'
import { clipHash } from './store'
import type { App, Deps } from '../context'
import { openDb } from '../db/client'
import type { Db } from '../db/client'
import type { Role } from '../env'
import { EventBus } from '../events'
import { OpenRouter } from '../llm/openrouter'
import { SpeechSupervisor } from '../speech/supervisor'

const defaults: Record<Role, string> = {
  conversation: 'qwen/c',
  judge: 'qwen/j',
  generator: 'qwen/g',
  translator: 'qwen/t',
}

/** A fake TTS: records every request and returns a tiny distinct clip. */
function fakeTts() {
  const calls: TtsRequest[] = []
  const tts = async (req: TtsRequest): Promise<Uint8Array> => {
    calls.push(req)
    const tag = req.instruct ?? ''
    return new TextEncoder().encode(`wav:${tag.slice(0, 8)}:${req.text}`)
  }
  return { tts, calls }
}

function makeApp() {
  const { db, sqlite } = openDb(':memory:')
  const { tts, calls } = fakeTts()
  const dataDir = mkdtempSync(join(tmpdir(), 'tutor-audio-'))
  const audio = createAudioService({ db, dataDir, tts })
  const deps: Deps = {
    db,
    or: new OpenRouter(undefined, 'http://127.0.0.1:1'),
    supervisor: new SpeechSupervisor({
      url: 'http://127.0.0.1:1',
      port: 1,
      pythonDir: '.',
      modelsDir: '.',
      idleTimeoutMs: 600_000,
      autostart: false,
    }),
    defaults,
    serverKey: undefined,
    secret: undefined,
    allowRegistration: true,
    sessionTtlMs: 86_400_000,
    events: new EventBus(),
    audio,
  }
  const app = createApp(deps, { staticDir: '/nope', log: false })
  return { app, db, sqlite, audio, calls, dataDir }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const auth = (cookie: string, extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { ...(extra.headers ?? {}), cookie },
})

async function signup(app: App, db: Db, username = 'alice') {
  const res = await app.request(
    '/api/auth/register',
    json({ username, password: 'password123', targetLang: 'zh' }),
  )
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const { user } = (await res.json()) as { user: { id: string } }
  return { cookie, userId: user.id }
}

/** Waits for the background recorder to drain. */
async function drain(audio: AudioService) {
  for (let i = 0; i < 200; i++) {
    const s = audio.status()
    if (s.pending === 0 && !s.running) return
    await Bun.sleep(5)
  }
  throw new Error('audio queue did not drain')
}

test('the voice set is two female and two male, all distinct', () => {
  expect(CARD_VOICES.length).toBe(4)
  expect(CARD_VOICES.filter((v) => v.gender === 'female').length).toBe(2)
  expect(CARD_VOICES.filter((v) => v.gender === 'male').length).toBe(2)
  expect(new Set(CARD_VOICES.map((v) => v.id)).size).toBe(4)
  expect(new Set(CARD_VOICES.map((v) => v.instruct)).size).toBe(4)
  expect(CARD_VOICES.every((v) => v.instruct.length > 40)).toBe(true)
})

test('ensure records every voice once, content-addressed and deduped', async () => {
  const { db, sqlite, audio, calls } = makeApp()
  await audio.ensure('你好', 'zh', 'user-1')
  expect(calls.length).toBe(4)
  expect(audio.complete('你好')).toBe(true)
  for (const v of CARD_VOICES) expect(audio.clip('你好', v.id)).toBeTruthy()

  // Recording the same text again is a no-op — the clips are already there.
  await audio.ensure('你好', 'zh', 'user-1')
  expect(calls.length).toBe(4)

  // Every clip is keyed by (voice, text), so a different voice is a new clip.
  const { findClip } = await import('./store')
  expect(findClip(db, clipHash('你好', 'f1'))).toBeTruthy()
  expect(findClip(db, clipHash('你好', 'm2'))).toBeTruthy()
  expect(findClip(db, clipHash('你好', 'f1'))?.bytes).toBeGreaterThan(0)
  sqlite.close()
})

test('enqueueUser queues only the cards that still lack clips', async () => {
  const { db, sqlite, audio } = makeApp()
  const { addCard } = await import('../db/repo')
  const { createDeck } = await import('../db/repo')
  const deck = createDeck(db, 'u1', { name: 'd', sourceLang: 'en', targetLang: 'zh' })
  addCard(db, 'u1', { deckId: deck.id, sourceLang: 'en', targetLang: 'zh', front: 'a', back: '一' })
  addCard(db, 'u1', { deckId: deck.id, sourceLang: 'en', targetLang: 'zh', front: 'b', back: '二' })
  await audio.ensure('一', 'zh', 'u1')
  const queued = audio.enqueueUser('u1')
  expect(queued).toBe(1)
  await drain(audio)
  expect(audio.complete('一')).toBe(true)
  expect(audio.complete('二')).toBe(true)
  expect(audio.enqueueUser('u1')).toBe(0)
  sqlite.close()
})

test('GET /api/cards/:id/audio streams a recorded voice', async () => {
  const { app, db, sqlite, audio } = makeApp()
  const { cookie } = await signup(app, db)

  const deckRes = await app.request('/api/decks', auth(cookie, json({ name: 'Demo' })))
  expect(deckRes.status).toBe(201)
  const { deck } = (await deckRes.json()) as { deck: { id: string } }

  const cardRes = await app.request(
    `/api/decks/${deck.id}/cards`,
    auth(cookie, json({ front: 'hello', back: '你好' })),
  )
  expect(cardRes.status).toBe(201)
  const { card } = (await cardRes.json()) as { card: { id: string } }

  // Creating the card queued its audio in the background.
  await drain(audio)

  const res = await app.request(`/api/cards/${card.id}/audio?variant=0`, auth(cookie))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('audio/wav')
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)

  // A variant beyond the set wraps around instead of 404ing.
  const wrapped = await app.request(`/api/cards/${card.id}/audio?variant=10`, auth(cookie))
  expect(wrapped.status).toBe(200)

  const missing = await app.request('/api/cards/nope/audio', auth(cookie))
  expect(missing.status).toBe(404)
  sqlite.close()
})

test('GET /api/cards/:id/audio is unauthorized without a session', async () => {
  const { app, sqlite } = makeApp()
  const res = await app.request('/api/cards/x/audio')
  expect(res.status).toBe(401)
  sqlite.close()
})

test('POST /api/audio/backfill queues the user cards and reports the queue', async () => {
  const { app, db, sqlite, audio } = makeApp()
  const { cookie } = await signup(app, db)
  const deckRes = await app.request('/api/decks', auth(cookie, json({ name: 'Demo' })))
  const { deck } = (await deckRes.json()) as { deck: { id: string } }
  await app.request(
    `/api/decks/${deck.id}/cards`,
    auth(cookie, json({ front: 'cat', back: '猫' })),
  )
  await drain(audio)

  const res = await app.request('/api/audio/backfill', auth(cookie, { method: 'POST' }))
  expect(res.status).toBe(202)
  const body = (await res.json()) as { queued: number; cards: number }
  expect(body.cards).toBeGreaterThanOrEqual(1)
  expect(body.queued).toBe(0) // already recorded when the card was created

  const status = (await (
    await app.request('/api/audio/status', auth(cookie))
  ).json()) as { voices: number }
  expect(status.voices).toBe(4)
  sqlite.close()
})
