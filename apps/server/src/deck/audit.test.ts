import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser, listCards } from '../db/repo'
import type { Db } from '../db/client'
import type { DeckId, UserId } from '../ids'
import { applyAudit, scanDeck } from './audit'

interface NewCardish {
  type: 'vocab' | 'phrase' | 'grammar'
  front: string
  back: string
  payload: Record<string, unknown>
}

function setup() {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'b', passwordHash: 'x' })
  const deck = createDeck(db, user.id, { name: 'd', sourceLang: 'en', targetLang: 'zh' })
  return { db, sqlite, userId: user.id, deckId: deck.id }
}

function add(db: Db, userId: UserId, deckId: DeckId, c: NewCardish) {
  return addCard(db, userId, {
    deckId,
    type: c.type,
    sourceLang: 'en',
    targetLang: 'zh',
    front: c.front,
    back: c.back,
    readings: {},
    tags: [],
    payload: c.payload,
    origin: 'llm',
  })
}

const vocab = (back: string, step: number): NewCardish => ({
  type: 'vocab',
  front: `m ${back}`,
  back,
  payload: { template: 'vocab', step },
})

const phrase = (
  back: string,
  step: number,
  tokens: string[],
  distractors: string[] = [],
): NewCardish => ({
  type: 'phrase',
  front: `g ${back}`,
  back,
  payload: { template: 'sentence', step, tokens, distractors },
})

function seed(db: Db, userId: UserId, deckId: DeckId) {
  add(db, userId, deckId, vocab('我', 1))
  add(db, userId, deckId, vocab('喝', 2))
  add(db, userId, deckId, vocab('茶', 3))
  add(db, userId, deckId, vocab('朋友', 9))
  add(db, userId, deckId, phrase('我朋友。', 2, ['我', '朋友']))
  add(db, userId, deckId, phrase('我喝。', 2, ['我', '喝'], ['茶']))
  add(db, userId, deckId, phrase('我喝茶。', 3, ['我', '喝', '茶']))
}

test('scanDeck reports cards that reach past what is known', async () => {
  const { db, sqlite, userId, deckId } = setup()
  seed(db, userId, deckId)
  const audit = await scanDeck(db, userId, deckId)
  expect(audit.checked).toBe(7)
  expect(audit.issues.map((i) => i.back).sort()).toEqual(['我喝。', '我朋友。'])
  const drop = audit.issues.find((i) => i.back === '我朋友。')!
  expect(drop.reasons.some((r) => r.includes('朋友'))).toBe(true)
  const prune = audit.issues.find((i) => i.back === '我喝。')!
  expect(prune.reasons).toEqual([])
  expect(prune.prune).toEqual(['茶'])
  sqlite.close()
})

test('a one-token sentence does not shadow the vocab card it repeats', async () => {
  const { db, sqlite, userId, deckId } = setup()
  add(db, userId, deckId, vocab('我', 1))
  add(db, userId, deckId, {
    type: 'vocab',
    front: 'Me.',
    back: '我。',
    payload: { template: 'vocab', step: 1, tokens: ['我'] },
  })
  add(db, userId, deckId, vocab('好', 2))
  add(db, userId, deckId, phrase('我好。', 2, ['我', '好']))
  const audit = await scanDeck(db, userId, deckId)
  expect(audit.issues.map((i) => i.back)).not.toContain('我好。')
  sqlite.close()
})

test('applyAudit drops failing cards and prunes their distractors', async () => {
  const { db, sqlite, userId, deckId } = setup()
  seed(db, userId, deckId)
  const applied = applyAudit(db, (await scanDeck(db, userId, deckId)).issues)
  expect(applied).toEqual({ dropped: 1, pruned: 1 })
  const cards = listCards(db, userId, deckId)
  expect(cards.map((c) => c.back)).not.toContain('我朋友。')
  const pruned = cards.find((c) => c.back === '我喝。')!
  expect(pruned.payload.distractors).toEqual([])
  sqlite.close()
})

test('applyAudit clears a clue that shows the answer instead of dropping the card', async () => {
  const { db, sqlite, userId, deckId } = setup()
  seed(db, userId, deckId)
  add(db, userId, deckId, vocab('的', 4))
  add(db, userId, deckId, {
    type: 'grammar',
    front: 'Possessive Particle',
    back: '的',
    payload: {
      template: 'grammar',
      step: 5,
      prompt: '我___茶。',
      answer: '的',
      options: ['的', '地', '得'],
      rule: 'Use 的 to mark possession.',
    },
  })
  const issue = (await scanDeck(db, userId, deckId)).issues.find((i) => i.back === '的')!
  expect(issue.reasons).toEqual([])
  expect(issue.strip).toEqual(['rule'])
  applyAudit(db, [issue])
  const card = listCards(db, userId, deckId).find((c) => c.type === 'grammar')!
  expect(card.payload.rule).toBeUndefined()
  expect(card.payload.prompt).toBe('我___茶。')
  sqlite.close()
})
