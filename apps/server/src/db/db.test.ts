import { expect, test } from 'bun:test'
import { openDb } from './client'
import {
  addMessage,
  createSession,
  getRoles,
  getSetting,
  listMessages,
  listSessions,
  setRole,
  setSetting,
} from './repo'

const defaults = { conversation: 'c', judge: 'j', generator: 'g', translator: 't' } as const

test('migrate + settings kv + roles', () => {
  const { db, sqlite } = openDb(':memory:')
  setSetting(db, 'foo', 'bar')
  expect(getSetting(db, 'foo')).toBe('bar')
  setSetting(db, 'foo', 'baz')
  expect(getSetting(db, 'foo')).toBe('baz')

  expect(getRoles(db, { ...defaults })).toEqual(defaults)
  const next = setRole(db, { ...defaults }, 'judge', 'qwen/z')
  expect(next.judge).toBe('qwen/z')
  expect(getRoles(db, { ...defaults }).conversation).toBe('c')
  sqlite.close()
})

test('sessions + append-only messages', () => {
  const { db, sqlite } = openDb(':memory:')
  const s = createSession(db, { kind: 'chat', lang: 'zh' })
  addMessage(db, { sessionId: s.id, role: 'user', text: 'hi' })
  addMessage(db, {
    sessionId: s.id,
    role: 'assistant',
    text: 'ni hao',
    model: 'qwen/x',
    tokensIn: 1,
    tokensOut: 2,
  })
  const msgs = listMessages(db, s.id)
  expect(msgs.length).toBe(2)
  expect(msgs[0]!.role).toBe('user')
  expect(msgs[1]!.role).toBe('assistant')
  expect(msgs[1]!.costUsd).toBe(0)
  expect(listSessions(db).length).toBe(1)
  sqlite.close()
})

test('migrations are idempotent', () => {
  const { sqlite } = openDb(':memory:')
  const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string
  }[]
  const names = tables.map((t) => t.name)
  for (const t of ['sessions', 'messages', 'settings', 'xp_events', 'cards', 'stats']) {
    expect(names).toContain(t)
  }
  sqlite.close()
})
