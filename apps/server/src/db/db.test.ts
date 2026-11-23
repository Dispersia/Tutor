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
  setRole,
  setSetting,
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
  setRole(db, a.id, { ...defaults }, 'judge', 'qwen/z')
  expect(getRoles(db, a.id, { ...defaults }).judge).toBe('qwen/z')
  // bob's roles are untouched — settings are per user
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
  expect(getOwnedSession(db, sa.id, b.id)).toBeUndefined() // bob can't reach alice's session
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
  // the progress it reached is kept — only the flag is cleared
  expect(after.cursor).toBe(30)
  expect(after.buildTotal).toBe(1477)

  // a deck that is not building is left alone
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

  // Nothing seen yet, so there is nothing to offer — a random unseen word would
  // be a guess, not a choice.
  expect(otherBacks(db, user.id, 'zh', a!.back)).toEqual([])

  // Two of the other cards have been met: the teach step and a graded review.
  addReview(db, { cardId: b!.id, userId: user.id, exerciseId: 'introduce', score: 100 })
  addReview(db, {
    cardId: c!.id,
    userId: user.id,
    exerciseId: 'translate.front_to_back',
    score: 100,
  })

  const backs = otherBacks(db, user.id, 'zh', a!.back).sort()
  expect(backs).toEqual([b!.back, c!.back].sort())
  expect(backs).not.toContain(d!.back) // 四 has never been seen
  expect(backs).not.toContain(a!.back) // the answer is never a distractor
  sqlite.close()
})

test('a private card extends the deck for one member and nobody else', async () => {
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
  expect(repo.listCards(db, b.id, deck.id).map((c) => c.back)).toEqual(['茶'])
  expect(repo.getCard(db, mine.id, a.id)?.back).toBe('我喝茶。')
  expect(repo.getCard(db, mine.id, b.id)).toBeUndefined()
  // the shared deck's size is the same for everyone
  expect(repo.listDecks(db)[0]!.cardCount).toBe(1)
  // a tool with no member sees everything; deleting the member takes their card along
  expect(repo.listCards(db).length).toBe(2)
  repo.deleteUser(db, a.id)
  expect(repo.listCards(db).map((c) => c.back)).toEqual(['茶'])
  sqlite.close()
})
