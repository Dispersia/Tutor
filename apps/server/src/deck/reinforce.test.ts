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
  expect(added[0]!.payload.step).toBe(2)
  expect(added[0]!.payload.template).toBe('sentence')

  await reinforceLapsedCard(deps, userId, targetId)
  added = listCards(db, userId, deckId).filter((c) => c.payload?.reinforces === targetId)
  expect(added.length).toBe(1)
  sqlite.close()
})

test('a reinforcement that reaches ahead to an unknown word is dropped', async () => {
  const { db, sqlite, userId, deckId, targetId } = deckWithVocab()
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

test('a reinforcement is attempted once per card, even when nothing was added', async () => {
  const { db, sqlite, userId, deckId, targetId } = deckWithVocab()
  let calls = 0
  const planner: Planner = async () => {
    calls++
    return [{ template: 'sentence', front: 'x', back: '我喝茶', payload: { tokens: ['茶'] } }]
  }
  const deps = { db, planner } as unknown as Deps
  await reinforceLapsedCard(deps, userId, targetId)
  await reinforceLapsedCard(deps, userId, targetId)
  await reinforceLapsedCard(deps, userId, targetId)
  expect(calls).toBe(1)
  expect(listCards(db, userId, deckId).length).toBe(3)
  sqlite.close()
})

test('two reviews racing on the same card ask the model once and add one card', async () => {
  const { db, sqlite, userId, deckId, targetId } = deckWithVocab()
  let calls = 0
  const planner: Planner = async () => {
    calls++
    await Bun.sleep(5)
    return [{ template: 'sentence', front: 'I drink', back: '我喝', payload: { tokens: ['我'] } }]
  }
  const deps = { db, planner } as unknown as Deps
  await Promise.all([
    reinforceLapsedCard(deps, userId, targetId),
    reinforceLapsedCard(deps, userId, targetId),
  ])
  expect(calls).toBe(1)
  const added = listCards(db, userId, deckId).filter((c) => c.payload?.reinforces === targetId)
  expect(added.length).toBe(1)
  sqlite.close()
})

test('a reinforcement card stores its reading in the deck script, not pinyin as Zhuyin', async () => {
  const { db, sqlite, userId, deckId, targetId } = deckWithVocab()
  const planner: Planner = async () => [
    {
      template: 'sentence',
      front: 'I drink',
      back: '我喝',
      reading: 'wǒ hē.',
      payload: { tokens: ['我', '喝'] },
    },
  ]
  await reinforceLapsedCard({ db, planner } as unknown as Deps, userId, targetId)
  const added = listCards(db, userId, deckId).find((c) => c.payload?.reinforces === targetId)!
  expect(added.readings.zhuyin).toBeTruthy()
  expect(added.readings.zhuyin).not.toMatch(/[a-z?]/i)
  sqlite.close()
})
