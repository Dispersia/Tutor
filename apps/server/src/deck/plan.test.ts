import { expect, test } from 'bun:test'
import { normalizePlan, stripMetaCommentary, tokensMatchBack } from './plan'

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
  // a leading "Translate:"/"Meaning:" is the model echoing its instruction
  expect(stripMetaCommentary('Translate: I guarantee.')).toBe('I guarantee.')
  expect(stripMetaCommentary('Meaning: to sleep')).toBe('to sleep')
})

test('normalizePlan drops leaked reasoning and long rule dumps', () => {
  const leaked =
    "Verb-Object: 劃 (draw) + 線 (line). Let's check the known list: '線' is NOT in known list. None are '線'. Correction: I cannot use it."
  const cards = normalizePlan({
    cards: [
      {
        template: 'vocab',
        front: 'I',
        back: '我',
        reading: 'ㄨㄛˇ',
        payload: { rule: leaked },
      },
      {
        template: 'vocab',
        front: 'you',
        back: '你',
        reading: 'ㄋㄧˇ',
        payload: { explanation: 'x'.repeat(300) },
      },
      {
        template: 'vocab',
        front: 'Translate: to drink',
        back: '喝',
        reading: 'ㄏㄜ',
        payload: { rule: 'verb' },
      },
    ],
  })
  // the leaked rule and the 300-char dump are dropped, the cards survive
  expect(cards[0]!.payload?.rule).toBeUndefined()
  expect(cards[1]!.payload?.explanation).toBeUndefined()
  // a leading "Translate:" is stripped, the rest of the rule is kept
  expect(cards[2]!.front).toBe('to drink')
  expect(cards[2]!.payload?.rule).toBe('verb')
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

test('stripMetaCommentary leaves ordinary words that happen to be markers', () => {
  for (const plain of [
    'to wait',
    'Please wait a moment.',
    'banknote',
    'I actually like it.',
    'correction',
    "Let's go.",
    'I must go now.',
  ]) {
    expect(stripMetaCommentary(plain)).toBe(plain)
  }
  // a real trailing aside still goes, and the sentence keeps its full stop
  expect(stripMetaCommentary('He will come. Wait, 來 is not introduced yet')).toBe('He will come.')
  expect(stripMetaCommentary('to sleep - note: informal')).toBe('to sleep')
})

test('normalizePlan keeps everyday sentences that contain a conversational marker', () => {
  const cards = normalizePlan({
    cards: [
      { template: 'vocab', front: 'to wait', back: '等' },
      { template: 'vocab', front: "Let's go.", back: '走吧' },
    ],
  })
  expect(cards.map((c) => c.front)).toEqual(['to wait', "Let's go."])
})

test('tokensMatchBack ignores case, spacing and punctuation, and passes a non-list', () => {
  expect(tokensMatchBack(['我', '很', '好'], '我很好。')).toBe(true)
  expect(tokensMatchBack(['I', 'am', 'fine'], 'i am fine!')).toBe(true)
  expect(tokensMatchBack(['我', '好'], '我很好。')).toBe(false)
  expect(tokensMatchBack(['我', 7, '很好'], '我很好')).toBe(true)
  expect(tokensMatchBack(undefined, '我很好')).toBe(true)
})
