import { expect, test } from 'bun:test'
import { openDb } from './client'
import {
  addMessage,
  countUsers,
  createSession,
  createUser,
  getRoles,
  getSetting,
  getOwnedSession,
  getUserByUsername,
  listMessages,
  listSessions,
  setRole,
  setSetting,
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
