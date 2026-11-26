import { expect, test } from 'bun:test'
import type { Deps } from '../context'
import {
  addMessage,
  createDeck,
  createSession,
  createUser,
  listCards,
  type PublicUser,
} from '../db/repo'
import { openDb } from '../db/client'
import type { ChatPlanner } from './plan'
import { saveChatCard, suggestChatCard } from './chatCard'

type Db = ReturnType<typeof openDb>['db']

function setup(langs: string[]) {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'c', passwordHash: 'x' })
  const decks = langs.map((targetLang) =>
    createDeck(db, user.id, { name: `${targetLang} deck`, sourceLang: 'en', targetLang }),
  )
  const session = createSession(db, user.id, { kind: 'chat', lang: langs[0] })
  addMessage(db, { sessionId: session.id, role: 'user', text: 'How do I say friend?' })
  addMessage(db, { sessionId: session.id, role: 'assistant', text: '친구.' })
  return { db, sqlite, user, decks, sessionId: session.id }
}

const planner =
  (targetLang: string, back: string): ChatPlanner =>
  async () => ({
    targetLang,
    cards: [{ template: 'vocab', front: 'friend', back }],
  })

function depsWith(db: Db, chatPlanner: ChatPlanner): Deps {
  return { db, chatPlanner } as unknown as Deps
}

const asUser = (user: { id: unknown }) =>
  ({
    id: user.id,
    username: null,
    handle: 'c',
    role: 'user',
    nativeLang: 'en',
    level: null,
    createdAt: 0,
  }) as PublicUser

test('a question about a language with a deck suggests a card in that deck', async () => {
  const { db, sqlite, user, decks, sessionId } = setup(['ko'])
  const deps = depsWith(db, planner('ko', '친구'))
  const suggestion = await suggestChatCard(deps, asUser(user), sessionId as never)
  expect(suggestion?.deckId).toBe(decks[0]!.id)
  expect(suggestion?.card.back).toBe('친구')
  sqlite.close()
})

test('a question about a language with no deck makes no card at all', async () => {
  const { db, sqlite, user, sessionId } = setup(['ko'])
  const deps = depsWith(db, planner('ru', 'друг'))
  const suggestion = await suggestChatCard(deps, asUser(user), sessionId as never)
  expect(suggestion).toBeUndefined()
  sqlite.close()
})

test('with no decks at all nothing is suggested and the model is never asked', async () => {
  const { db, sqlite, user, sessionId } = setup([])
  let called = 0
  const deps = depsWith(db, async () => {
    called++
    return { targetLang: 'ko', cards: [{ template: 'vocab', front: 'friend', back: '친구' }] }
  })
  const suggestion = await suggestChatCard(deps, asUser(user), sessionId as never)
  expect(suggestion).toBeUndefined()
  expect(called).toBe(0)
  sqlite.close()
})

test('a confirmed card is stored privately in the matching deck', async () => {
  const { db, sqlite, user, decks, sessionId } = setup(['ko'])
  const deps = depsWith(db, planner('ko', '친구'))
  const suggestion = (await suggestChatCard(deps, asUser(user), sessionId as never))!
  const saved = await saveChatCard(deps, asUser(user), suggestion)
  expect(saved?.back).toBe('친구')
  const cards = listCards(db, user.id, decks[0]!.id)
  expect(cards.map((c) => c.back)).toContain('친구')
  expect(cards.find((c) => c.back === '친구')?.tags).toContain('chat')
  sqlite.close()
})

test('a save for a deck language that does not match is refused', async () => {
  const { db, sqlite, user, decks, sessionId } = setup(['ko'])
  const deps = depsWith(db, planner('ko', '친구'))
  const suggestion = (await suggestChatCard(deps, asUser(user), sessionId as never))!
  const saved = await saveChatCard(deps, asUser(user), {
    ...suggestion,
    targetLang: 'ru',
    deckId: decks[0]!.id,
  })
  expect(saved).toBeUndefined()
  expect(listCards(db, user.id, decks[0]!.id).length).toBe(0)
  sqlite.close()
})

test('a card with no drills that offer the right answer is refused on save', async () => {
  const { db, sqlite, user, decks, sessionId } = setup(['ko'])
  const deps = depsWith(db, planner('ko', '친구'))
  const suggestion = (await suggestChatCard(deps, asUser(user), sessionId as never))!
  const saved = await saveChatCard(deps, asUser(user), {
    ...suggestion,
    card: { template: 'vocab', front: '', back: '친구' },
  })
  expect(saved).toBeUndefined()
  expect(listCards(db, user.id, decks[0]!.id).length).toBe(0)
  sqlite.close()
})

test('the stored card is private to its owner', async () => {
  const { db, sqlite, user, decks, sessionId } = setup(['ko'])
  const other = createUser(db, { username: 'o', passwordHash: 'x' })
  const deps = depsWith(db, planner('ko', '친구'))
  const suggestion = (await suggestChatCard(deps, asUser(user), sessionId as never))!
  await saveChatCard(deps, asUser(user), suggestion)
  expect(listCards(db, other.id, decks[0]!.id).length).toBe(0)
  sqlite.close()
})

test('a card that is not a vocab or grammar shape is sanitized away', async () => {
  const { db, sqlite, user, sessionId } = setup(['ko'])
  const deps = depsWith(db, async () => ({
    targetLang: 'ko',
    cards: [{ template: 'grammar', front: 'topic particle', back: '은' }],
  }))
  const suggestion = await suggestChatCard(deps, asUser(user), sessionId as never)
  expect(suggestion).toBeUndefined()
  sqlite.close()
})
