import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../app'
import { createAudioService, type AudioService, type TtsRequest } from './service'
import { CARD_VOICES } from './voices'
import { clipHash, findClip, legacyClipHash, writeClip } from './store'
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
  await audio.ensure({ text: '你好', language: 'zh', userId: 'user-1' })
  expect(calls.length).toBe(4)
  expect(audio.complete('你好', 'zh')).toBe(true)
  for (const v of CARD_VOICES) expect(audio.clip('你好', 'zh', v.id)).toBeTruthy()

  // Recording the same text again is a no-op — the clips are already there.
  await audio.ensure({ text: '你好', language: 'zh', userId: 'user-1' })
  expect(calls.length).toBe(4)

  // Every clip is keyed by (voice, language, text), so a different voice is a new clip.
  expect(findClip(db, clipHash('你好', 'f1', 'zh'))).toBeTruthy()
  expect(findClip(db, clipHash('你好', 'm2', 'zh'))).toBeTruthy()
  expect(findClip(db, clipHash('你好', 'f1', 'zh'))?.bytes).toBeGreaterThan(0)
  sqlite.close()
})

test('enqueueUser queues only the cards that still lack clips', async () => {
  const { db, sqlite, audio } = makeApp()
  const { addCard } = await import('../db/repo')
  const { createDeck } = await import('../db/repo')
  const deck = createDeck(db, 'u1', { name: 'd', sourceLang: 'en', targetLang: 'zh' })
  addCard(db, 'u1', { deckId: deck.id, sourceLang: 'en', targetLang: 'zh', front: 'a', back: '一' })
  addCard(db, 'u1', { deckId: deck.id, sourceLang: 'en', targetLang: 'zh', front: 'b', back: '二' })
  await audio.ensure({ text: '一', language: 'zh', userId: 'u1' })
  const queued = audio.enqueueUser('u1')
  expect(queued).toBe(1)
  await drain(audio)
  expect(audio.complete('一', 'zh')).toBe(true)
  expect(audio.complete('二', 'zh')).toBe(true)
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
  await app.request(`/api/decks/${deck.id}/cards`, auth(cookie, json({ front: 'cat', back: '猫' })))
  await drain(audio)

  const res = await app.request('/api/audio/backfill', auth(cookie, { method: 'POST' }))
  expect(res.status).toBe(202)
  const body = (await res.json()) as { queued: number; cards: number }
  expect(body.cards).toBeGreaterThanOrEqual(1)
  expect(body.queued).toBe(0) // already recorded when the card was created

  const status = (await (await app.request('/api/audio/status', auth(cookie))).json()) as {
    voices: number
  }
  expect(status.voices).toBe(4)
  sqlite.close()
})

test('a word two languages share gets its own clip per language', async () => {
  const { sqlite, audio, calls } = makeApp()
  await audio.ensure({ text: '先生', language: 'zh', userId: 'u1' })
  expect(audio.complete('先生', 'zh')).toBe(true)
  // the Mandarin recording must not satisfy the Japanese card
  expect(audio.complete('先生', 'ja')).toBe(false)
  await audio.ensure({ text: '先生', language: 'ja', userId: 'u1' })
  expect(calls.filter((c) => c.language === 'ja').length).toBe(CARD_VOICES.length)
  sqlite.close()
})

test('a clip recorded before the language was keyed is adopted only when unambiguous', async () => {
  const { db, sqlite, audio, dataDir } = makeApp()
  const { addCard, createDeck } = await import('../db/repo')
  const old = new TextEncoder().encode('old-recording')
  const zh = createDeck(db, 'u1', { name: 'zh', sourceLang: 'en', targetLang: 'zh' })
  const ja = createDeck(db, 'u1', { name: 'ja', sourceLang: 'en', targetLang: 'ja' })
  const card = { sourceLang: 'en', front: 'x' }
  addCard(db, 'u1', { ...card, deckId: zh.id, targetLang: 'zh', back: '你好' })
  addCard(db, 'u1', { ...card, deckId: zh.id, targetLang: 'zh', back: '水' })
  addCard(db, 'u1', { ...card, deckId: ja.id, targetLang: 'ja', back: '水' })
  writeClip(db, dataDir, 'u1', legacyClipHash('你好', 'f1'), old)
  writeClip(db, dataDir, 'u1', legacyClipHash('水', 'f1'), old)

  // only Mandarin cards say 你好: the old clip is theirs, moved to the new key
  expect(audio.clip('你好', 'zh', 'f1')).toEqual(old)
  expect(findClip(db, legacyClipHash('你好', 'f1'))).toBeUndefined()
  // 水 is in both decks: the old clip could be either, so neither language keeps it
  expect(audio.clip('水', 'ja', 'f1')).toBeUndefined()
  expect(audio.clip('水', 'zh', 'f1')).toBeUndefined()
  sqlite.close()
})

test('only the admin may cancel the shared queue, start a backfill or stop the gateway', async () => {
  const { app, db, sqlite } = makeApp()
  const admin = await signup(app, db, 'admin')
  const member = await signup(app, db, 'member')
  const post = (path: string, cookie: string) => app.request(path, auth(cookie, { method: 'POST' }))
  for (const path of ['/api/audio/cancel', '/api/audio/backfill', '/api/speech/unload']) {
    expect((await post(path, member.cookie)).status).toBe(403)
  }
  expect((await post('/api/audio/cancel', admin.cookie)).status).toBe(200)
  expect((await post('/api/audio/backfill', admin.cookie)).status).toBe(202)
  sqlite.close()
})

test('each clip is recorded in its language’s accent, and spoken as written', async () => {
  const { sqlite, audio, calls } = makeApp()
  await audio.ensureVoice({ text: '你好', language: 'zh', userId: 'u1', voiceId: 'f1' })
  expect(calls[0]!.instruct).toContain('Taiwanese accent')
  // a Japanese word keeps its kanji: the kanji carries the word, and so its pitch
  await audio.ensureVoice({ text: '橋', language: 'ja', userId: 'u1', voiceId: 'f1' })
  expect(calls[1]!.text).toBe('橋')
  expect(calls[1]!.instruct).toContain('Japanese')
  sqlite.close()
})

/** An audio service whose recogniser "hears" the scripted transcripts in order. */
function gradedService(heard: string[]) {
  const { db, sqlite } = openDb(':memory:')
  const { tts, calls } = fakeTts()
  const dataDir = mkdtempSync(join(tmpdir(), 'tutor-audio-'))
  const asr = async () => heard.shift() ?? ''
  return { sqlite, calls, audio: createAudioService({ db, dataDir, tts, asr }) }
}

test('a take that says more than the word is thrown away and recorded again', async () => {
  // take 1 rambles on after the word, take 2 is clean
  const { sqlite, audio, calls } = gradedService(['茶，我喜歡喝茶。', '茶'])
  await audio.ensureVoice({ text: '茶', language: 'zh', userId: 'u1', voiceId: 'f1' })
  expect(calls.length).toBe(2)
  expect(audio.clip('茶', 'zh', 'f1')).toBeTruthy()
  expect(audio.status().rejected).toBe(0)
  sqlite.close()
})

test('when no take says the word, no clip is stored and it is not retried', async () => {
  const { sqlite, audio, calls } = gradedService(['嗯', '好的', ''])
  const job = { text: '茶', language: 'zh', userId: 'u1', voiceId: 'f1' }
  await audio.ensureVoice(job)
  expect(calls.length).toBe(3)
  expect(audio.clip('茶', 'zh', 'f1')).toBeUndefined()
  expect(audio.status().rejected).toBe(1)
  // asking again does not burn three more takes
  await audio.ensureVoice(job)
  expect(calls.length).toBe(3)
  sqlite.close()
})
