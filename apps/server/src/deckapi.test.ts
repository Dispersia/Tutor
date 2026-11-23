import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from './app'
import type { App, Deps } from './context'
import { openDb } from './db/client'
import { awaitDeckBuild, parseInstruction, PLAN_CHUNK } from './deck/generate'
import type { PlannedCard, Planner, PlanRequest } from './deck/plan'
import type { PitchFetcher, PitchWord } from './deck/pitch'
import type { Role } from './env'
import { EventBus } from './events'
import type { Fetcher } from './frequency/source'
import { OpenRouter } from './llm/openrouter'
import { SpeechSupervisor } from './speech/supervisor'

const defaults: Record<Role, string> = {
  conversation: 'qwen/c',
  judge: 'qwen/j',
  generator: 'qwen/g',
  translator: 'qwen/t',
}

/** A tiny stand-in for a pulled frequency list (no network in tests). */
const FAKE_LIST = ['的 100', '我 90', '你 80', '他 70', '好 60', '是 50', '不 40', '在 30'].join(
  '\n',
)

const fetcher: Fetcher = async () => FAKE_LIST

/** Deterministic planner: one vocab card per requested word, plus one grammar. */
const planner: Planner = async (req) => {
  const cards: PlannedCard[] = []
  for (const w of req.words.slice(0, req.count)) {
    cards.push({ template: 'vocab', front: `meaning ${w}`, back: w, reading: `r-${w}` })
  }
  const first = req.words[0]
  if (first) {
    cards.push({
      template: 'grammar',
      front: `Use ${first}`,
      back: first,
      reading: `r-${first}`,
      payload: { answer: first, rule: 'demo', explanation: 'a demo rule' },
    })
  }
  return cards
}

function makeApp(overrides: Partial<Deps> = {}) {
  const { db, sqlite } = openDb(':memory:')
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
    fetcher,
    planner,
    ...overrides,
  }
  const app = createApp(deps, { staticDir: '/nope', log: false })
  return { app, sqlite }
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

async function signup(app: App, username = 'alice') {
  const res = await app.request('/api/auth/register', json({ username, password: 'password123' }))
  return res.headers.getSetCookie()[0]!.split(';')[0]!
}

type DeckBody = {
  deck: { id: string; name: string; targetLang: string; settings: Record<string, unknown> }
  cardCount: number
  source: string
  newWords: string[]
}

test('parseInstruction reads the character variant and reading script', () => {
  const zh = parseInstruction(
    'I want a traditional Chinese frequency list with grammar, using only traditional Chinese and zhuyin',
    'zh',
  )
  expect(zh.variant).toBe('traditional')
  expect(zh.readingScript).toBe('zhuyin')
  expect(parseInstruction('simplified chinese with pinyin', 'zh').variant).toBe('simplified')
  expect(parseInstruction('japanese with furigana', 'ja').readingScript).toBe('kana')
  expect(parseInstruction('japanese with romaji', 'ja').readingScript).toBe('romaji')
  // a Chinese prompt remembered from another deck never forces Zhuyin on Japanese
  expect(parseInstruction('traditional chinese with zhuyin', 'ja')).toEqual({
    variant: undefined,
    readingScript: 'kana',
    pitchAccent: false,
  })
  // pitch-accent metadata is opt-in, by instruction
  expect(parseInstruction('japanese with pitch accent', 'ja').pitchAccent).toBe(true)
  expect(parseInstruction('japanese frequency list', 'ja').pitchAccent).toBe(false)
})

test('POST /api/decks builds a deck from an instruction and a pulled list', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const res = await app.request(
    '/api/decks',
    auth(
      cookie,
      json({
        instruction: 'traditional Chinese frequency list with grammar, zhuyin only',
        targetLang: 'zh',
        count: 4,
      }),
    ),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as DeckBody
  expect(body.source).toContain('Traditional')
  expect(body.newWords).toEqual(['的', '我', '你', '他'])
  // deck carries its own reading rules
  expect(body.deck.settings.variant).toBe('traditional')
  expect(body.deck.settings.readingScript).toBe('zhuyin')

  const cards = (await (
    await app.request(`/api/decks/${body.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { back: string; type: string; payload: Record<string, unknown> }[] }
  // 4 vocab + 1 grammar
  expect(cards.cards.length).toBe(5)
  const vocab = cards.cards.filter((c) => c.payload.template === 'vocab')
  expect(vocab.length).toBe(4)
  // strict n+1: one step per new word, in frequency order
  expect(vocab.map((c) => c.payload.step)).toEqual([1, 2, 3, 4])
  const grammar = cards.cards.find((c) => c.payload.template === 'grammar')!
  expect(grammar.payload.step).toBe(4) // shares the last introduced word's step
  sqlite.close()
})

test('POST /api/decks/:id/cards adds a card, optionally into a lesson', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 3 })),
    )
  ).json()) as DeckBody

  // With a step it joins that lesson (the n+1 group).
  const res = await app.request(
    `/api/decks/${created.deck.id}/cards`,
    auth(cookie, json({ front: 'a sentence', back: '你好', type: 'phrase', step: 2 })),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    card: { id: string; payload: Record<string, unknown> }
    step: number
  }
  expect(body.step).toBe(2)
  expect(body.card.payload.step).toBe(2)
  expect(body.card.payload.template).toBe('phrase')

  const cards = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string }[] }
  expect(cards.cards.some((c) => c.id === body.card.id)).toBe(true)

  // Without a step it appends a fresh step at the end.
  const appended = (await (
    await app.request(
      `/api/decks/${created.deck.id}/cards`,
      auth(cookie, json({ front: 'more', back: '再' })),
    )
  ).json()) as { step: number }
  expect(appended.step).toBeGreaterThan(2)
  sqlite.close()
})

test('POST /api/decks needs a planner (OpenRouter key)', async () => {
  const { app, sqlite } = makeApp({ planner: undefined })
  const cookie = await signup(app)
  const res = await app.request(
    '/api/decks',
    auth(cookie, json({ instruction: 'spanish frequency list', targetLang: 'es' })),
  )
  expect(res.status).toBe(502)
  sqlite.close()
})

test('POST /api/decks/:id/grow appends an n+1 batch, optionally on a topic', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 2 })),
    )
  ).json()) as DeckBody

  const grown = (await (
    await app.request(
      `/api/decks/${created.deck.id}/grow`,
      auth(cookie, json({ topic: 'ordering at a restaurant', count: 2 })),
    )
  ).json()) as DeckBody
  expect(grown.cardCount).toBeGreaterThan(created.cardCount)
  // the second batch continues the frequency list (cursor advanced)
  expect(grown.newWords).toEqual(['你', '他'])
  sqlite.close()
})

test('growing a deck keeps its original prompt and adds the topic', async () => {
  const calls: PlanRequest[] = []
  const recording: Planner = async (req) => {
    calls.push(req)
    return req.words.slice(0, req.count).map((w) => ({
      template: 'vocab' as const,
      front: `meaning ${w}`,
      back: w,
      reading: `r-${w}`,
    }))
  }
  const { app, sqlite } = makeApp({ planner: recording })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'my special deck prompt', targetLang: 'zh', count: 2 })),
    )
  ).json()) as DeckBody

  await app.request(
    `/api/decks/${created.deck.id}/grow`,
    auth(cookie, json({ topic: 'ordering at a restaurant', count: 1 })),
  )
  const last = calls[calls.length - 1]!
  // the prompt is not replaced by the topic — both reach the planner
  expect(last.instruction).toBe('my special deck prompt')
  expect(last.topic).toBe('ordering at a restaurant')
  sqlite.close()
})

test('a new deck reuses the prompt from the previous one', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  await app.request(
    '/api/decks',
    auth(
      cookie,
      json({ instruction: 'traditional Chinese, zhuyin only', targetLang: 'zh', count: 2 }),
    ),
  )

  // the settings expose it for the deck builder to prefill
  const settings = (await (await app.request('/api/settings', auth(cookie))).json()) as {
    deckInstruction: string
  }
  expect(settings.deckInstruction).toBe('traditional Chinese, zhuyin only')

  // an import with no typed prompt still carries it
  const apkg = readFileSync(join(import.meta.dir, 'anki/fixtures/sample.apkg'))
  const form = new FormData()
  form.set('file', new File([apkg], 'sample.apkg'))
  form.set('targetLang', 'zh')
  form.set('count', '4')
  form.set('wordField', '0')
  const res = await app.request('/api/decks/import', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as DeckBody
  expect(body.deck.settings.instruction).toBe('traditional Chinese, zhuyin only')
  await awaitDeckBuild(body.deck.id)
  sqlite.close()
})

test('DELETE /api/decks/:id removes the deck and its cards', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 2 })),
    )
  ).json()) as DeckBody

  const res = await app.request(`/api/decks/${created.deck.id}`, auth(cookie, { method: 'DELETE' }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, deckId: created.deck.id })

  const list = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: unknown[]
  }
  expect(list.decks).toEqual([])
  const cards = await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  expect(cards.status).toBe(404)
  sqlite.close()
})

test('a deck cannot be deleted by another account', async () => {
  const { app, sqlite } = makeApp()
  const alice = await signup(app, 'alice')
  const bob = await signup(app, 'bob')
  const created = (await (
    await app.request(
      '/api/decks',
      auth(alice, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 2 })),
    )
  ).json()) as DeckBody

  const denied = await app.request(`/api/decks/${created.deck.id}`, auth(bob, { method: 'DELETE' }))
  expect(denied.status).toBe(404)

  const stillThere = await app.request(`/api/decks/${created.deck.id}/cards`, auth(alice))
  expect(stillThere.status).toBe(200)
  sqlite.close()
})

test('a deck override hides readings for its cards', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 3 })),
    )
  ).json()) as DeckBody

  const reading = async () =>
    (
      (await (
        await app.request(
          '/api/practice/next',
          auth(cookie, json({ deckId: created.deck.id, exerciseId: 'translate.back_to_front' })),
        )
      ).json()) as { instance: { data: { reading?: string } } }
    ).instance.data.reading

  expect(await reading()).toBeTruthy()

  // PATCH the deck's own rule: hide readings (wins over the user preference)
  const patched = await app.request(
    `/api/decks/${created.deck.id}`,
    auth(cookie, { ...json({ settings: { showReadings: false } }), method: 'PATCH' }),
  )
  expect(patched.status).toBe(200)
  expect(await reading()).toBe('')
  sqlite.close()
})

test('pitch-accent metadata flows from the planner to the learner', async () => {
  const calls: PlanRequest[] = []
  const pitchPlanner: Planner = async (req) => {
    calls.push(req)
    return req.words.slice(0, req.count).map((w) => ({
      template: 'vocab' as const,
      front: `meaning ${w}`,
      back: w,
      reading: `r-${w}`,
      metadata: { pitch: { syllables: ['か', 'み'], levels: ['L', 'H'], drop: 2 } },
    }))
  }
  const { app, sqlite } = makeApp({ planner: pitchPlanner })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'japanese with pitch accent', targetLang: 'ja', count: 2 })),
    )
  ).json()) as DeckBody
  expect(calls[0]!.pitchAccent).toBe(true)
  expect(created.deck.settings.pitchAccent).toBe(true)

  const cards = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as {
    cards: { metadata: { pitch?: { levels: string[]; drop?: number; syllables?: string[] } } }[]
  }
  expect(cards.cards[0]!.metadata.pitch).toEqual({
    syllables: ['か', 'み'],
    levels: ['L', 'H'],
    drop: 2,
  })

  // the annotation reaches the exercise data (so the UI can render it)
  const next = (await (
    await app.request(
      '/api/practice/next',
      auth(cookie, json({ deckId: created.deck.id, exerciseId: 'translate.back_to_front' })),
    )
  ).json()) as { instance: { data: { pitch?: { levels: string[] } } } }
  expect(next.instance.data.pitch?.levels).toEqual(['L', 'H'])
  sqlite.close()
})

test('POST /api/decks/:id/pitch backfills pitch for cards that lack it', async () => {
  const seen: PitchWord[][] = []
  const pitch: PitchFetcher = async (words) => {
    seen.push(words)
    return new Map(words.map((w) => [w.word, { levels: ['L', 'H'], drop: 1 }]))
  }
  const { app, sqlite } = makeApp({ pitch })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'japanese frequency list', targetLang: 'ja', count: 3 })),
    )
  ).json()) as DeckBody
  // the deck was built without asking for pitch
  expect(created.deck.settings.pitchAccent).toBeFalsy()

  const before = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { metadata: { pitch?: unknown } }[] }
  expect(before.cards.every((c) => !c.metadata.pitch)).toBe(true)

  const res = (await (
    await app.request(`/api/decks/${created.deck.id}/pitch`, auth(cookie, { method: 'POST' }))
  ).json()) as { updated: number; total: number }
  expect(res.updated).toBeGreaterThan(0)
  expect(seen[0]!.length).toBe(res.updated)

  const after = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { metadata: { pitch?: { levels: string[] } } }[] }
  expect(after.cards[0]!.metadata.pitch?.levels).toEqual(['L', 'H'])

  // a second run has nothing left to annotate
  const again = (await (
    await app.request(`/api/decks/${created.deck.id}/pitch`, auth(cookie, { method: 'POST' }))
  ).json()) as { updated: number }
  expect(again.updated).toBe(0)
  sqlite.close()
})

test('a generated Chinese deck reads words from the Taiwan dictionary', async () => {
  // the planner's readings are wrong on purpose: the dictionary must win
  const zhPlanner: Planner = async () => [
    { template: 'vocab', front: 'possessive particle', back: '的', reading: 'de' },
    { template: 'vocab', front: 'nonsense', back: 'x-test', reading: 'mā' },
  ]
  const { app, sqlite } = makeApp({ planner: zhPlanner })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 2 })),
    )
  ).json()) as DeckBody
  const cards = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { back: string; readings: Record<string, string> }[] }
  // 的 resolves to its Taiwan Zhuyin; an unknown word keeps the planner's
  // reading — converted from pinyin, so the learner never sees Latin letters.
  expect(cards.cards.find((c) => c.back === '的')?.readings.zhuyin).toBe('ㄉㄜ˙')
  expect(cards.cards.find((c) => c.back === 'x-test')?.readings.zhuyin).toBe('ㄇㄚ')
  sqlite.close()
})

test('PATCH a card metadata merges annotations and null removes one', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 2 })),
    )
  ).json()) as DeckBody
  const list = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { id: string }[] }
  const cardId = list.cards[0]!.id

  const first = (await (
    await app.request(
      `/api/decks/${created.deck.id}/cards/${cardId}`,
      auth(cookie, {
        ...json({ metadata: { pitch: 'LHHL', radical: '水' } }),
        method: 'PATCH',
      }),
    )
  ).json()) as { card: { metadata: { pitch?: { levels: string[] }; radical?: string } } }
  // the "LHHL" shorthand is normalised into a contour; other keys pass through
  expect(first.card.metadata.pitch?.levels).toEqual(['L', 'H', 'H', 'L'])
  expect(first.card.metadata.radical).toBe('水')

  const second = (await (
    await app.request(
      `/api/decks/${created.deck.id}/cards/${cardId}`,
      auth(cookie, { ...json({ metadata: { radical: null } }), method: 'PATCH' }),
    )
  ).json()) as { card: { metadata: { pitch?: unknown; radical?: string } } }
  expect(second.card.metadata.radical).toBeUndefined()
  expect(second.card.metadata.pitch).toBeDefined()
  sqlite.close()
})

test('POST /api/decks/inspect previews the deck fields before import', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const apkg = readFileSync(join(import.meta.dir, 'anki/fixtures/sample.apkg'))
  const form = new FormData()
  form.set('file', new File([apkg], 'sample.apkg'))
  form.set('targetLang', 'zh')
  const res = await app.request('/api/decks/inspect', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    fields: string[]
    noteCount: number
    sample: string[][]
    suggested: { wordField: number }
  }
  expect(body.fields).toEqual(['Word', 'Reading', 'Meaning'])
  expect(body.noteCount).toBe(4)
  expect(body.sample[0]).toEqual(['我', 'ㄨㄛˇ', 'I, me'])
  expect(body.suggested.wordField).toBe(0)
  sqlite.close()
})

test('POST /api/decks/import builds a whole deck from an uploaded Anki package', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const apkg = readFileSync(join(import.meta.dir, 'anki/fixtures/sample.apkg'))
  const form = new FormData()
  form.set('file', new File([apkg], 'sample.apkg'))
  form.set('targetLang', 'zh')
  // no count: the whole deck is imported, not a 20-word first batch
  form.set('wordField', '0')
  form.set('readingField', '1')
  form.set('meaningField', '2')
  const res = await app.request('/api/decks/import', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as DeckBody & {
    words: number
    fields: string[]
    building: boolean
  }
  expect(body.source).toBe('Imported Chinese')
  expect(body.words).toBe(4)
  expect(body.fields).toEqual(['Word', 'Reading', 'Meaning'])
  // the response returns immediately; the cards fill in the background
  expect(body.building).toBe(true)
  // …and the flag is really stored (the learn page polls on it)
  expect(body.deck.settings.building).toBe(true)

  await awaitDeckBuild(body.deck.id)
  const after = (await (
    await app.request(`/api/decks/${body.deck.id}/cards`, auth(cookie))
  ).json()) as {
    deck: { settings: Record<string, unknown> }
    cards: { back: string; payload: Record<string, unknown> }[]
  }
  const vocab = after.cards.filter((c) => c.payload.template === 'vocab')
  expect(vocab.map((c) => c.back)).toEqual(['我', '你', '喝', '茶'])
  // the generator weaves a grammar card through the imported words
  expect(after.cards.some((c) => c.payload.template === 'grammar')).toBe(true)
  expect(after.deck.settings.building).toBe(false)

  // the imported deck can grow from its stored word list (no frequency pull)
  const grown = (await (
    await app.request(
      `/api/decks/${body.deck.id}/grow`,
      auth(cookie, json({ count: 2, topic: 'restaurant' })),
    )
  ).json()) as DeckBody
  expect(grown.source).toBe('uploaded deck')
  sqlite.close()
})

test('POST /api/decks/import handles a modern schema-18 package', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const apkg = readFileSync(join(import.meta.dir, 'anki/fixtures/modern-schema18.apkg'))
  const form = new FormData()
  form.set('file', new File([apkg], 'modern.apkg'))
  form.set('targetLang', 'zh')
  form.set('wordField', '0')
  form.set('readingField', '1')
  form.set('meaningField', '2')
  const res = await app.request('/api/decks/import', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as DeckBody
  expect(body.source).toBe('Imported Modern')

  await awaitDeckBuild(body.deck.id)
  const after = (await (
    await app.request(`/api/decks/${body.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { back: string; payload: Record<string, unknown> }[] }
  const vocab = after.cards.filter((c) => c.payload.template === 'vocab')
  expect(vocab.map((c) => c.back)).toEqual(['我', '你', '喝', '茶'])
  sqlite.close()
})

test('POST /api/decks/import detects the deck language when none is given', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const apkg = readFileSync(join(import.meta.dir, 'anki/fixtures/modern-schema18.apkg'))
  const form = new FormData()
  form.set('file', new File([apkg], 'modern.apkg'))
  form.set('wordField', '0')
  // no targetLang: the deck's own script (Han) decides
  const res = await app.request('/api/decks/import', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as DeckBody
  expect(body.deck.targetLang).toBe('zh')
  await awaitDeckBuild(body.deck.id)
  sqlite.close()
})

test('POST /api/decks/import rejects a non-package', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const form = new FormData()
  form.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'nope.apkg'))
  const res = await app.request('/api/decks/import', auth(cookie, { method: 'POST', body: form }))
  expect(res.status).toBe(502)
  sqlite.close()
})

test('GET /api/decks exposes each deck settings', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  await app.request(
    '/api/decks',
    auth(cookie, json({ instruction: 'chinese frequency list', targetLang: 'zh', count: 2 })),
  )
  const body = (await (await app.request('/api/decks', auth(cookie))).json()) as {
    decks: { settings: { instruction?: string } }[]
  }
  expect(body.decks[0]!.settings.instruction).toContain('chinese frequency list')
  sqlite.close()
})

test('generated sentence/grammar cards that reach ahead of their words are dropped', async () => {
  // The planner is only *asked* to stay n+1; the loader must enforce it. These
  // cards reach ahead to words the deck introduces much later (the real "dono
  // before its own card" bug).
  const list = ['w1 100', 'w2 90', 'w3 80', 'w4 70', 'w5 60', 'w6 50'].join('\n')
  const futureFetcher: Fetcher = async () => list
  const aheadPlanner: Planner = async () => {
    const cards: PlannedCard[] = [
      { template: 'vocab', front: 'v1', back: 'w1', reading: 'r1' },
      // uses only w1 (known) -> kept
      { template: 'sentence', front: 's-w1', back: 'w1', payload: { tokens: ['w1'] } },
      // uses w5 before w5's vocab card -> dropped (n+1)
      { template: 'sentence', front: 's-w5', back: 'w5', payload: { tokens: ['w5'] } },
      { template: 'vocab', front: 'v2', back: 'w2', reading: 'r2' },
      { template: 'vocab', front: 'v3', back: 'w3', reading: 'r3' },
      // grammar whose answer is still to come -> dropped
      { template: 'grammar', front: 'g-w6', back: 'w6', payload: { answer: 'w6', rule: 'r' } },
      // grammar built on an introduced word -> kept
      { template: 'grammar', front: 'g-w3', back: 'w3', payload: { answer: 'w3', rule: 'r' } },
    ]
    return cards
  }
  const { app, sqlite } = makeApp({ fetcher: futureFetcher, planner: aheadPlanner })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(cookie, json({ instruction: 'frequency list', targetLang: 'zh', count: 3 })),
    )
  ).json()) as DeckBody

  const cards = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as {
    cards: { front: string; back: string; payload: Record<string, unknown> }[]
  }
  const fronts = cards.cards.map((c) => c.front)
  expect(fronts).toContain('s-w1')
  expect(fronts).toContain('g-w3')
  expect(fronts).not.toContain('s-w5')
  expect(fronts).not.toContain('g-w6')
  // the kept cards still carry their n+1 step
  expect(cards.cards.find((c) => c.front === 'g-w3')!.payload.step).toBe(3)
  sqlite.close()
})

test('a large build chunks the planner and keeps n+1 across chunks', async () => {
  const words = Array.from({ length: PLAN_CHUNK * 2 + 0 }, (_, i) => `w${i + 1}`)
  const bigFetcher: Fetcher = async () => words.map((w, i) => `${w} ${1000 - i}`).join('\n')
  const calls: PlanRequest[] = []
  const chunkPlanner: Planner = async (req) => {
    calls.push(req)
    const vocab: PlannedCard[] = req.words.slice(0, req.count).map((w) => ({
      template: 'vocab' as const,
      front: `meaning ${w}`,
      back: w,
      reading: `r-${w}`,
    }))
    const first = req.words[0]
    const sentence: PlannedCard = {
      template: 'sentence',
      front: 'build it',
      back: first ?? '',
      payload: { tokens: [first ?? ''] },
    }
    return [...vocab, sentence]
  }
  const { app, sqlite } = makeApp({ fetcher: bigFetcher, planner: chunkPlanner })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(
        cookie,
        json({ instruction: 'chinese frequency list', targetLang: 'zh', count: words.length }),
      ),
    )
  ).json()) as DeckBody

  // one planner call per chunk, never more than PLAN_CHUNK words
  expect(calls.length).toBe(2)
  expect(calls.every((c) => c.words.length <= PLAN_CHUNK)).toBe(true)
  // each later batch is told the words the earlier ones introduced (n+1)
  expect(calls[0]!.knownWords.length).toBe(0)
  expect(calls[1]!.knownWords.length).toBe(PLAN_CHUNK)
  expect(created.newWords.length).toBe(words.length)

  // the sentence card shares the last introduced word's n+1 step
  const cards = (await (
    await app.request(`/api/decks/${created.deck.id}/cards`, auth(cookie))
  ).json()) as { cards: { payload: Record<string, unknown> }[] }
  const steps = cards.cards.filter((c) => c.payload.template === 'vocab').map((c) => c.payload.step)
  expect(steps).toEqual(words.map((_, i) => i + 1))
  sqlite.close()
})

test('a batch that overflows the model is retried smaller, not abandoned', async () => {
  const words = Array.from({ length: PLAN_CHUNK * 2 }, (_, i) => `w${i + 1}`)
  const bigFetcher: Fetcher = async () => words.map((w, i) => `${w} ${1000 - i}`).join('\n')
  const calls: PlanRequest[] = []
  // accept only small batches — anything wider "truncates" like a real model
  const flaky: Planner = async (req) => {
    calls.push(req)
    if (req.count > 10)
      throw new Error('the model ran out of output space before its JSON was complete')
    return req.words.slice(0, req.count).map((w) => ({
      template: 'vocab' as const,
      front: `meaning ${w}`,
      back: w,
      reading: `r-${w}`,
    }))
  }
  const { app, sqlite } = makeApp({ fetcher: bigFetcher, planner: flaky })
  const cookie = await signup(app)
  const created = (await (
    await app.request(
      '/api/decks',
      auth(
        cookie,
        json({ instruction: 'chinese frequency list', targetLang: 'zh', count: words.length }),
      ),
    )
  ).json()) as DeckBody

  // every word made it despite the first (large) batch failing
  expect(created.newWords.length).toBe(words.length)
  expect(calls[0]!.count).toBe(PLAN_CHUNK)
  expect(calls.some((c) => c.count <= 10)).toBe(true)
  sqlite.close()
})

test('grow { all: true } finishes a partly-imported deck in the background', async () => {
  const { app, sqlite } = makeApp()
  const cookie = await signup(app)
  const apkg = readFileSync(join(import.meta.dir, 'anki/fixtures/sample.apkg'))
  const form = new FormData()
  form.set('file', new File([apkg], 'sample.apkg'))
  form.set('targetLang', 'zh')
  form.set('count', '2') // import only the first two of the deck's four words
  form.set('wordField', '0')
  const res = await app.request('/api/decks/import', auth(cookie, { method: 'POST', body: form }))
  const body = (await res.json()) as DeckBody
  await awaitDeckBuild(body.deck.id)

  // the deck still has the rest of its list to build
  const grown = (await (
    await app.request(`/api/decks/${body.deck.id}/grow`, auth(cookie, json({ all: true })))
  ).json()) as { remaining: number; building: boolean }
  expect(grown.remaining).toBe(2)
  expect(grown.building).toBe(true)
  await awaitDeckBuild(body.deck.id)

  const after = (await (
    await app.request(`/api/decks/${body.deck.id}/cards`, auth(cookie))
  ).json()) as {
    deck: { settings: Record<string, unknown> }
    cards: { back: string; payload: Record<string, unknown> }[]
  }
  const vocab = after.cards.filter((c) => c.payload.template === 'vocab').map((c) => c.back)
  expect(vocab).toEqual(['我', '你', '喝', '茶'])
  expect(after.deck.settings.building).toBe(false)
  sqlite.close()
})
