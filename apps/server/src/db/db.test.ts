import { expect, test } from 'bun:test'
import { openDb } from './client'
import {
  addCard,
  addMessage,
  addReview,
  clearDeckBuilds,
  countUsers,
  createDeck,
  createSession,
  createUser,
  getDeck,
  getRoles,
  getSetting,
  getOwnedSession,
  getUserByUsername,
  listMessages,
  listSessions,
  otherBacks,
  setSetting,
  setUserSetting,
  updateDeckSettings,
} from './repo'

const defaults = { conversation: 'c', judge: 'j', generator: 'g', translator: 't' } as const

test('migrate + server settings', () => {
  const { db, sqlite } = openDb(':memory:')
  setSetting(db, 'foo', 'bar')
  expect(getSetting(db, 'foo')).toBe('bar')
  setSetting(db, 'foo', 'baz')
  expect(getSetting(db, 'foo')).toBe('baz')
  expect(countUsers(db)).toBe(0)
  sqlite.close()
})

test('users: create, lookup, per-user roles', () => {
  const { db, sqlite } = openDb(':memory:')
  const a = createUser(db, { username: 'alice', passwordHash: 'x', role: 'admin' })
  const b = createUser(db, { username: 'bob', passwordHash: 'y' })
  expect(countUsers(db)).toBe(2)
  expect(getUserByUsername(db, 'alice')?.id).toBe(a.id)

  expect(getRoles(db, a.id, { ...defaults })).toEqual(defaults)
  setUserSetting(db, a.id, 'roles', JSON.stringify({ ...defaults, judge: 'qwen/z' }))
  expect(getRoles(db, a.id, { ...defaults }).judge).toBe('qwen/z')
  expect(getRoles(db, b.id, { ...defaults }).judge).toBe('j')
  sqlite.close()
})

test('sessions + messages are scoped to their owner', () => {
  const { db, sqlite } = openDb(':memory:')
  const a = createUser(db, { username: 'alice', passwordHash: 'x' })
  const b = createUser(db, { username: 'bob', passwordHash: 'y' })

  const sa = createSession(db, a.id, { kind: 'chat', lang: 'zh' })
  addMessage(db, { sessionId: sa.id, role: 'user', text: 'hi' })
  addMessage(db, { sessionId: sa.id, role: 'assistant', text: 'ni hao', model: 'qwen/x' })

  expect(listSessions(db, a.id).length).toBe(1)
  expect(listSessions(db, b.id).length).toBe(0)
  expect(getOwnedSession(db, sa.id, a.id)?.id).toBe(sa.id)
  expect(getOwnedSession(db, sa.id, b.id)).toBeUndefined()
  expect(listMessages(db, sa.id).length).toBe(2)
  sqlite.close()
})

test('migrations are idempotent and include the new tables', () => {
  const { sqlite } = openDb(':memory:')
  const names = (
    sqlite.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  ).map((t) => t.name)
  for (const t of ['users', 'auth_sessions', 'user_settings', 'sessions', 'messages', 'settings']) {
    expect(names).toContain(t)
  }
  sqlite.close()
})

test('clearDeckBuilds lifts a build flag left behind by a restart', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  const deck = createDeck(db, user.id, {
    name: 'Kaishi',
    sourceLang: 'en',
    targetLang: 'ja',
    settings: { building: true, buildTotal: 1477, cursor: 30 },
  })
  expect(getDeck(db, deck.id)?.settings.building).toBe(true)

  expect(clearDeckBuilds(db)).toBe(1)
  const after = getDeck(db, deck.id)!.settings
  expect(after.building).toBe(false)
  expect(after.cursor).toBe(30)
  expect(after.buildTotal).toBe(1477)

  updateDeckSettings(db, deck.id, { building: false })
  expect(clearDeckBuilds(db)).toBe(0)
  sqlite.close()
})

test('otherBacks only offers words the learner has already met', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'alice', passwordHash: 'x' })
  const deck = createDeck(db, user.id, { name: 'd', sourceLang: 'en', targetLang: 'zh' })
  const mk = (back: string) =>
    addCard(db, user.id, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: 'zh',
      front: `f-${back}`,
      back,
    })
  const [a, b, c, d] = ['一', '二', '三', '四'].map(mk)

  expect(otherBacks(db, user.id, 'zh', a!.back)).toEqual([])

  addReview(db, { cardId: b!.id, userId: user.id, exerciseId: 'introduce', score: 100 })
  addReview(db, {
    cardId: c!.id,
    userId: user.id,
    exerciseId: 'translate.front_to_back',
    score: 100,
  })

  const backs = otherBacks(db, user.id, 'zh', a!.back).sort()
  expect(backs).toEqual([b!.back, c!.back].sort())
  expect(backs).not.toContain(d!.back)
  expect(backs).not.toContain(a!.back)
  sqlite.close()
})

test('a member only sees the cards in their own decks', async () => {
  const { openDb } = await import('./client')
  const repo = await import('./repo')
  const { db, sqlite } = openDb(':memory:')
  const a = repo.createUser(db, { username: 'a', passwordHash: 'x' })
  const b = repo.createUser(db, { username: 'b', passwordHash: 'x' })
  const deck = repo.createDeck(db, a.id, { name: 'd', sourceLang: 'en', targetLang: 'zh' })
  const card = { deckId: deck.id, sourceLang: 'en', targetLang: 'zh' }
  repo.addCard(db, a.id, { ...card, front: 'tea', back: '茶' })
  const mine = repo.addCard(db, a.id, {
    ...card,
    front: 'I drink tea.',
    back: '我喝茶。',
    privateTo: a.id,
  })

  expect(repo.listCards(db, a.id, deck.id).map((c) => c.back)).toEqual(['茶', '我喝茶。'])
  expect(repo.listCards(db, b.id, deck.id).map((c) => c.back)).toEqual([])
  expect(repo.getCard(db, mine.id, a.id)?.back).toBe('我喝茶。')
  expect(repo.getCard(db, mine.id, b.id)).toBeUndefined()
  expect(repo.listDecks(db, a.id)[0]!.cardCount).toBe(1)
  expect(repo.listDecks(db, b.id).length).toBe(0)
  expect(repo.listCards(db).length).toBe(2)
  repo.deleteUser(db, a.id)
  expect(repo.listCards(db).length).toBe(0)
  sqlite.close()
})

test('deck and card writes are scoped to their owner', async () => {
  const { openDb } = await import('./client')
  const repo = await import('./repo')
  const { db, sqlite } = openDb(':memory:')
  const a = repo.createUser(db, { username: 'a', passwordHash: 'x' })
  const b = repo.createUser(db, { username: 'b', passwordHash: 'x' })
  const deck = repo.createDeck(db, a.id, { name: 'd', sourceLang: 'en', targetLang: 'zh' })
  const card = repo.addCard(db, a.id, {
    deckId: deck.id,
    sourceLang: 'en',
    targetLang: 'zh',
    front: 'f',
    back: 'b',
  })

  expect(repo.updateDeckSettings(db, deck.id, { showReadings: true }, b.id)).toBeUndefined()
  expect(repo.getDeck(db, deck.id)!.settings.showReadings).toBeUndefined()
  repo.updateCard(db, card.id, { front: 'hacked' }, b.id)
  expect(repo.getCard(db, card.id, a.id)!.front).toBe('f')
  repo.deleteDeck(db, deck.id, b.id)
  expect(repo.getDeck(db, deck.id)).toBeDefined()

  expect(repo.updateDeckSettings(db, deck.id, { showReadings: true }, a.id)).toBeDefined()
  repo.updateCard(db, card.id, { front: 'mine' }, a.id)
  expect(repo.getCard(db, card.id, a.id)!.front).toBe('mine')
  repo.deleteDeck(db, deck.id, a.id)
  expect(repo.getDeck(db, deck.id)).toBeUndefined()
  sqlite.close()
})
