import { expect, test } from 'bun:test'
import { openDb, type Db } from '../db/client'
import { addCard, createDeck, createUser, listCards, updateCard } from '../db/repo'
import type { DeckId, UserId } from '../ids'
import {
  ensureGrammarExample,
  ensureGrammarExplanation,
  ensureGrammarTeaching,
  needsGrammarTeaching,
  startGrammarExamples,
} from './grammarExamples'
import { awaitDeckBuild } from './jobs'
import type { PlannedCard, Planner } from './plan'

const sentence: PlannedCard = {
  template: 'sentence',
  front: 'I am a student.',
  back: '私は学生です。',
  reading: 'わたしはがくせいです',
  payload: { tokens: ['私', 'は', '学生', 'です'], gloss: 'I am a student.' },
}

const planner: Planner = async () => [sentence]

const explainerCards: PlannedCard[] = [
  {
    template: 'grammar',
    front: 'topic particle',
    back: 'は',
    payload: {
      prompt: '私___です。',
      answer: 'は',
      options: ['は', 'が'],
      rule: 'topic particle',
      explanation: 'Use は to mark the topic and が for the subject.',
    },
  },
]

const explainer: Planner = async () => explainerCards

function grammarDeck() {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'a', passwordHash: 'x' })
  const deck = createDeck(db, user.id, { name: 'g', sourceLang: 'en', targetLang: 'ja' })
  addCard(db, user.id, {
    deckId: deck.id,
    type: 'grammar',
    sourceLang: 'en',
    targetLang: 'ja',
    front: 'topic particle',
    back: 'は',
    readings: { kana: 'は' },
    payload: { template: 'grammar', rule: 'topic particle', answer: 'は', step: 1 },
  })
  return { db, sqlite, userId: user.id, deckId: deck.id }
}

function exampleOf(db: Db, userId: UserId, deckId: DeckId) {
  return listCards(db, userId, deckId)[0]!.payload.example
}

test('a grammar example is built from the known words and stored on the card', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  startGrammarExamples(db, userId, deckId, planner, ['私', 'は', '学生', 'です'])
  await awaitDeckBuild(deckId)
  expect(exampleOf(db, userId, deckId)).toEqual({
    text: '私は学生です。',
    reading: 'わたしはがくせいです',
    gloss: 'I am a student.',
  })
  sqlite.close()
})

test('no example is stored while a word in it is still unknown', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  startGrammarExamples(db, userId, deckId, planner, ['私', 'は', 'です'])
  await awaitDeckBuild(deckId)
  expect(exampleOf(db, userId, deckId)).toBeUndefined()
  sqlite.close()
})

test('no example is stored before the learner knows any words', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  startGrammarExamples(db, userId, deckId, planner, [])
  await awaitDeckBuild(deckId)
  expect(exampleOf(db, userId, deckId)).toBeUndefined()
  sqlite.close()
})

test('the grammar point itself need not be a word the learner has met', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  startGrammarExamples(db, userId, deckId, planner, ['私', '学生', 'です'])
  await awaitDeckBuild(deckId)
  expect(exampleOf(db, userId, deckId)).toMatchObject({ text: '私は学生です。' })
  sqlite.close()
})

test('an example is generated on demand when the deck was imported too early', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  const card = listCards(db, userId, deckId)[0]!
  expect(card.payload.example).toBeUndefined()
  const updated = await ensureGrammarExample(db, userId, card, planner, ['私', '学生', 'です'])
  expect(updated.payload.example).toMatchObject({ text: '私は学生です。' })
  expect(exampleOf(db, userId, deckId)).toMatchObject({ text: '私は学生です。' })
  sqlite.close()
})

function asIntro(db: Db, userId: UserId, deckId: DeckId) {
  const card = listCards(db, userId, deckId)[0]!
  updateCard(db, card.id, { payload: { ...card.payload, intro: true } })
}

function explanationOf(db: Db, userId: UserId, deckId: DeckId) {
  return listCards(db, userId, deckId)[0]!.payload.explanation
}

test('an intro grammar card gets its explanation on demand', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  asIntro(db, userId, deckId)
  const card = listCards(db, userId, deckId)[0]!
  expect(explanationOf(db, userId, deckId)).toBeUndefined()
  const updated = await ensureGrammarExplanation(db, userId, card, explainer, ['私'])
  expect(updated.payload.explanation).toBe('Use は to mark the topic and が for the subject.')
  expect(explanationOf(db, userId, deckId)).toBe(updated.payload.explanation)
  sqlite.close()
})

test('a card that already explains itself is not asked again', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  asIntro(db, userId, deckId)
  const first = listCards(db, userId, deckId)[0]!
  await ensureGrammarExplanation(db, userId, first, explainer, ['私'])
  let calls = 0
  const counting: Planner = async () => {
    calls++
    return explainerCards
  }
  const card = listCards(db, userId, deckId)[0]!
  await ensureGrammarExplanation(db, userId, card, counting, ['私'])
  expect(calls).toBe(0)
  sqlite.close()
})

const teaching: Planner = async () => [...explainerCards, sentence]

test('a grammar card needs teaching until it has an example', () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  const card = listCards(db, userId, deckId)[0]!
  expect(needsGrammarTeaching(card)).toBe(true)
  updateCard(db, card.id, { payload: { ...card.payload, example: { text: 'x' } } })
  expect(needsGrammarTeaching(listCards(db, userId, deckId)[0]!)).toBe(false)
  sqlite.close()
})

test('an intro grammar card needs teaching while its explanation is missing', () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  const card = listCards(db, userId, deckId)[0]!
  updateCard(db, card.id, {
    payload: { ...card.payload, intro: true, example: { text: 'x' } },
  })
  expect(needsGrammarTeaching(listCards(db, userId, deckId)[0]!)).toBe(true)
  sqlite.close()
})

test('teaching an intro card fills its explanation and its example in one pass', async () => {
  const { db, sqlite, userId, deckId } = grammarDeck()
  asIntro(db, userId, deckId)
  const card = listCards(db, userId, deckId)[0]!
  const taught = await ensureGrammarTeaching(db, userId, card, teaching, ['私', '学生', 'です'])
  expect(taught.payload.explanation).toBe('Use は to mark the topic and が for the subject.')
  expect(taught.payload.example).toMatchObject({ text: '私は学生です。' })
  const stored = listCards(db, userId, deckId)[0]!
  expect(stored.payload.explanation).toBe(taught.payload.explanation)
  expect(stored.payload.example).toMatchObject({ text: '私は学生です。' })
  sqlite.close()
})
