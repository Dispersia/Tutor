import { expect, test } from 'bun:test'
import { normalizePlan, stripMetaCommentary } from './plan'

test('stripMetaCommentary removes the model’s asides but keeps plain glosses', () => {
  expect(stripMetaCommentary('My you. (Grammatically valid, though semantically odd)')).toBe(
    'My you.',
  )
  expect(stripMetaCommentary('I have (it).')).toBe('I have (it).')
  expect(
    stripMetaCommentary('He will come. (Wait, 來 is not introduced yet. Correction: skip)'),
  ).toBe('He will come.')
  expect(stripMetaCommentary('I miss you. / I think about you.')).toBe(
    'I miss you. / I think about you.',
  )
})

test('normalizePlan drops cards whose text is only reasoning, or whose tokens do not match', () => {
  const cards = normalizePlan({
    cards: [
      // clean vocab + sentence survive
      { template: 'vocab', front: 'I', back: '我', reading: 'ㄨㄛˇ' },
      {
        template: 'sentence',
        front: 'I drink tea.',
        back: '我喝茶。',
        payload: { tokens: ['我', '喝', '茶'], gloss: 'I drink tea.' },
      },
      // a front that is only the model's reasoning is not a translation
      {
        template: 'sentence',
        front: 'Note: skip this one',
        back: '我有。',
        payload: { tokens: ['我', '有'], gloss: 'I have it.' },
      },
      // tokens that no longer rebuild the sentence are corrupt
      {
        template: 'sentence',
        front: 'I have it.',
        back: '我有。',
        payload: { tokens: ['你', '有'], gloss: 'I have it.' },
      },
    ],
  })
  expect(cards.map((c) => c.back)).toEqual(['我', '我喝茶。'])
})

test('normalizePlan cleans meta-commentary out of a kept gloss', () => {
  const cards = normalizePlan({
    cards: [
      {
        template: 'sentence',
        front: 'You have it.',
        back: '你有。',
        payload: {
          tokens: ['你', '有'],
          gloss: 'You have (it). (Note: 有 needs an object in strict grammar)',
        },
      },
    ],
  })
  expect(cards).toHaveLength(1)
  expect(cards[0]!.payload?.gloss).toBe('You have (it).')
})
