import { expect, test } from 'bun:test'
import type { Deps } from '../context'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser, listCards } from '../db/repo'
import type { Planner } from './plan'
import { reinforceLapsedCard } from './reinforce'

function deckWithVocab() {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'r', passwordHash: 'x' })
  const deck = createDeck(db, user.id, {
    name: 'd',
    sourceLang: 'en',
    targetLang: 'zh',
    description: 'test',
  })
  const mk = (back: string, step: number) =>
    addCard(db, user.id, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: 'zh',
      front: `meaning ${back}`,
      back,
      readings: {},
      tags: [],
      payload: { template: 'vocab', step },
      origin: 'llm',
    })
  mk('我', 1)
  const target = mk('喝', 2)
  mk('茶', 3)
  return { db, sqlite, userId: user.id, deckId: deck.id, targetId: target.id }
}

test('a word that keeps lapsing gains one n+1 card, once', async () => {
  const { db, sqlite, userId, deckId, targetId } = deckWithVocab()
  // Uses only 我 (known) + 喝 (the word) — strict n+1.
  const planner: Planner = async () => [
    {
      template: 'sentence',
      front: 'I drink',
      back: '我喝',
      payload: { tokens: ['我', '喝'], gloss: 'I drink' },
    },
  ]
  const deps = { db, planner } as unknown as Deps

  await reinforceLapsedCard(deps, userId, targetId)
  let added = listCards(db, userId, deckId).filter((c) => c.payload?.reinforces === targetId)
  expect(added.length).toBe(1)
  expect(added[0]!.payload.step).toBe(2) // joins the word's lesson
  expect(added[0]!.payload.template).toBe('sentence')

  // A second lapse never adds a duplicate.
  await reinforceLapsedCard(deps, userId, targetId)
  added = listCards(db, userId, deckId).filter((c) => c.payload?.reinforces === targetId)
  expect(added.length).toBe(1)
  sqlite.close()
})

test('a reinforcement that reaches ahead to an unknown word is dropped', async () => {
  const { db, sqlite, userId, deckId, targetId } = deckWithVocab()
  // 茶 is introduced later (step 3), so this sentence is not n+1 for 喝.
  const planner: Planner = async () => [
    {
      template: 'sentence',
      front: 'I drink tea',
      back: '我喝茶',
      payload: { tokens: ['我', '喝', '茶'] },
    },
  ]
  const deps = { db, planner } as unknown as Deps

  await reinforceLapsedCard(deps, userId, targetId)
  const added = listCards(db, userId, deckId).filter((c) => c.payload?.reinforces === targetId)
  expect(added.length).toBe(0)
  sqlite.close()
})
