import { expect, test } from 'bun:test'
import { applyVerdicts, reviewMessages, type ReviewRequest } from './review'
import type { PlannedCard } from './plan'

const vocab = (back: string): PlannedCard => ({
  template: 'vocab',
  front: `m ${back}`,
  back,
  reading: 'r',
})

test('a card the reviewer never mentioned is kept', () => {
  const cards = [vocab('a'), vocab('b')]
  expect(applyVerdicts(cards, [])).toEqual(cards)
})

test('a fix replaces the reading or the meaning and keeps the card', () => {
  const cards = [vocab('a')]
  const fixed = applyVerdicts(cards, [{ index: 0, action: 'fix', problems: [], reading: 'R' }])
  expect(fixed[0]!.reading).toBe('R')
  expect(fixed[0]!.front).toBe('m a')
  const meaning = applyVerdicts(cards, [{ index: 0, action: 'fix', problems: [], front: 'god' }])
  expect(meaning[0]!.front).toBe('god')
})

test('a drop verdict, or any problem without a fix, removes the card', () => {
  const cards = [vocab('a'), vocab('b'), vocab('c')]
  const kept = applyVerdicts(cards, [
    { index: 0, action: 'drop', problems: ['wrong tone'] },
    { index: 1, action: 'keep', problems: ['unnatural'] },
    { index: 2, action: 'keep', problems: [] },
  ])
  expect(kept.map((c) => c.back)).toEqual(['c'])
})

test('the review request names the language, the words and every card', () => {
  const req: ReviewRequest = {
    instruction: 'x',
    targetLang: 'ja',
    sourceLang: 'en',
    words: ['学生'],
    knownWords: ['私'],
    cards: [
      { template: 'sentence', front: 'I am a student.', back: '私は学生です。', reading: 'r' },
    ],
  }
  const [system, user] = reviewMessages(req)
  expect(system!.role).toBe('system')
  expect(user!.content).toContain('Japanese')
  expect(user!.content).toContain('私は学生です。')
})
