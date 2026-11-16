import { expect, test } from 'bun:test'
import { openDb } from './client'
import {
  addMessage,
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
  expect(getDeck(db, deck.id, user.id)?.settings.building).toBe(true)

  expect(clearDeckBuilds(db)).toBe(1)
  const after = getDeck(db, deck.id, user.id)!.settings
  expect(after.building).toBe(false)
  // the progress it reached is kept — only the flag is cleared
  expect(after.cursor).toBe(30)
  expect(after.buildTotal).toBe(1477)

  // a deck that is not building is left alone
  updateDeckSettings(db, deck.id, user.id, { building: false })
  expect(clearDeckBuilds(db)).toBe(0)
  sqlite.close()
})
