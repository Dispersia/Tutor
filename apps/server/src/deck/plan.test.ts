import { expect, test } from 'bun:test'
import {
  DECK_SCHEMA,
  normalizePlan,
  storedTemplate,
  stripMetaCommentary,
  tokensMatchBack,
} from './plan'
import type { PlannedCard } from './plan'

interface CardVariant {
  properties: { template: { const: string }; payload: { required?: string[] } }
}

function cardVariants(): CardVariant[] {
  const items = DECK_SCHEMA.properties.cards.items as unknown as { anyOf: CardVariant[] }
  return items.anyOf
}

test('the deck schema demands an explanation on grammar cards, and only those', () => {
  const required = Object.fromEntries(
    cardVariants().map((v) => [v.properties.template.const, v.properties.payload.required ?? []]),
  )
  expect(required).toEqual({ vocab: [], sentence: [], grammar: ['explanation'] })
})

test('storedTemplate treats a one-token sentence as a word', () => {
  const sentence = (back: string, tokens: string[]): PlannedCard => ({
    template: 'sentence',
    front: `m ${back}`,
    back,
    payload: { tokens },
  })
  expect(storedTemplate({ template: 'vocab', front: 'yes', back: '네' })).toBe('vocab')
  expect(storedTemplate({ template: 'grammar', front: 'x', back: 'y' })).toBe('grammar')
  expect(storedTemplate(sentence('네.', ['네']))).toBe('vocab')
  expect(storedTemplate(sentence('차를 마셔요.', ['차를', '마셔요.']))).toBe('sentence')
  expect(storedTemplate({ template: 'sentence', front: 'x', back: '你好嗎？' })).toBe('sentence')
})

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
  expect(stripMetaCommentary('Translate: I guarantee.')).toBe('I guarantee.')
  expect(stripMetaCommentary('Meaning: to sleep')).toBe('to sleep')
})

test('normalizePlan keeps pitch metadata only for Japanese', () => {
  const raw = {
    cards: [
      {
        template: 'vocab',
        front: 'student',
        back: '학생',
        metadata: { pitch: { syllables: ['학', '생'], levels: ['L', 'H'] } },
      },
    ],
  }
  expect(normalizePlan(raw, 'ko')[0]!.metadata).toBeUndefined()
  expect(normalizePlan(raw, 'ja')[0]!.metadata).toEqual({
    pitch: { levels: ['L', 'H'], drop: null, syllables: ['학', '생'] },
  })
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
        payload: { explanation: 'x'.repeat(1200) },
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
  expect(cards[0]!.payload?.rule).toBeUndefined()
  expect(cards[1]!.payload?.explanation).toBeUndefined()
  expect(cards[2]!.front).toBe('to drink')
  expect(cards[2]!.payload?.rule).toBe('verb')
})

test('normalizePlan drops cards whose text is only reasoning, or whose tokens do not match', () => {
  const cards = normalizePlan({
    cards: [
      { template: 'vocab', front: 'I', back: '我', reading: 'ㄨㄛˇ' },
      {
        template: 'sentence',
        front: 'I drink tea.',
        back: '我喝茶。',
        payload: { tokens: ['我', '喝', '茶'], gloss: 'I drink tea.' },
      },
      {
        template: 'sentence',
        front: 'Note: skip this one',
        back: '我有。',
        payload: { tokens: ['我', '有'], gloss: 'I have it.' },
      },
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

test('normalizePlan drops a grammar card whose answer repeats the prompt', () => {
  const cards = normalizePlan({
    cards: [
      {
        template: 'grammar',
        front: '有 indicates possession.',
        back: '我有',
        payload: {
          prompt: '我___',
          answer: '我有',
          options: ['我在', '我是', '我有'],
          rule: '有 indicates possession.',
        },
      },
      {
        template: 'grammar',
        front: 'verb before object',
        back: '喝',
        payload: {
          prompt: '我___茶。',
          answer: '喝',
          options: ['喝', '茶'],
          rule: 'verb before object',
        },
      },
    ],
  })
  expect(cards.map((c) => c.back)).toEqual(['喝'])
})

test('normalizePlan keeps a long, complete grammar explanation', () => {
  const explanation =
    '은 comes after a consonant and 는 after a vowel, and both mark the topic of the sentence. The mistake is using 는 after a consonant.'
  const cards = normalizePlan({
    cards: [
      {
        template: 'grammar',
        front: 'Topic particle 는 / 은',
        back: '는',
        payload: {
          prompt: '저___학생이에요.',
          answer: '는',
          options: ['는', '은'],
          rule: 'topic particle',
          explanation,
        },
      },
    ],
  })
  expect(cards[0]!.payload?.explanation).toBe(explanation)
})

test('normalizePlan drops an intro grammar card that carries no explanation', () => {
  const cards = normalizePlan({
    cards: [
      {
        template: 'grammar',
        front: 'Copula: 이에요 / 예요',
        back: '이에요',
        payload: {
          prompt: '저 학생___.',
          answer: '이에요',
          options: ['이에요', '예요'],
          rule: 'copula',
          intro: true,
        },
      },
      {
        template: 'grammar',
        front: 'Copula: 이에요 / 예요',
        back: '이에요',
        payload: {
          prompt: '저 학생___.',
          answer: '이에요',
          options: ['이에요', '예요'],
          rule: 'copula',
          intro: true,
          explanation: 'copula',
        },
      },
    ],
  })
  expect(cards).toHaveLength(0)
})

test('normalizePlan keeps an intro explanation longer than the old cap', () => {
  const explanation = '이에요 comes after a consonant and 예요 after a vowel. '.repeat(11).trim()
  expect(explanation.length).toBeGreaterThan(420)
  expect(explanation.length).toBeLessThan(800)
  const cards = normalizePlan({
    cards: [
      {
        template: 'grammar',
        front: 'Copula: 이에요 / 예요',
        back: '이에요',
        payload: {
          prompt: '저 학생___.',
          answer: '이에요',
          options: ['이에요', '예요'],
          rule: 'copula',
          intro: true,
          explanation,
        },
      },
    ],
  })
  expect(cards[0]!.payload?.explanation).toBe(explanation)
})

test('normalizePlan drops a bare-blank prompt and strips a clue that shows the answer', () => {
  const cards = normalizePlan({
    cards: [
      {
        template: 'grammar',
        front: "Choose the correct particle for possession: 'I ___ book'.",
        back: '的',
        payload: {
          prompt: '我___',
          answer: '的',
          options: ['的', '了', '不'],
          rule: 'Possessive particle 的',
        },
      },
      {
        template: 'grammar',
        front: 'Possessive Particle',
        back: '的',
        payload: {
          prompt: '這是我___帽子。',
          answer: '的',
          options: ['的', '地', '得'],
          rule: 'Use 的 to mark possession.',
        },
      },
    ],
  })
  expect(cards.map((c) => c.back)).toEqual(['的'])
  expect(cards[0]!.payload?.prompt).toBe('這是我___帽子。')
  expect(cards[0]!.payload?.rule).toBeUndefined()
})

test('a grammar card with no blank becomes a vocab card, or is dropped', () => {
  const cards = normalizePlan({
    cards: [
      { template: 'grammar', front: 'you (singular)', back: '你', payload: { intro: true } },
      { template: 'grammar', front: 'a pattern', back: '吧', payload: { rule: 'a pattern' } },
    ],
  })
  expect(cards.map((c) => `${c.template}:${c.back}`)).toEqual(['vocab:你'])
})

test('the word card of a point with no blank keeps its explanation', () => {
  const cards = normalizePlan({
    cards: [
      {
        template: 'grammar',
        front: 'Topic particle: は',
        back: 'は',
        payload: {
          intro: true,
          explanation: 'は marks the topic and is read わ.',
          example: { text: '私は人です。', gloss: 'I am a person.' },
        },
      },
    ],
  })
  expect(cards[0]!.template).toBe('vocab')
  expect(cards[0]!.payload).toEqual({
    explanation: 'は marks the topic and is read わ.',
    example: { text: '私は人です。', gloss: 'I am a person.' },
  })
})

test('tokensMatchBack ignores case, spacing and punctuation, and passes a non-list', () => {
  expect(tokensMatchBack(['我', '很', '好'], '我很好。')).toBe(true)
  expect(tokensMatchBack(['I', 'am', 'fine'], 'i am fine!')).toBe(true)
  expect(tokensMatchBack(['我', '好'], '我很好。')).toBe(false)
  expect(tokensMatchBack(['我', 7, '很好'], '我很好')).toBe(true)
  expect(tokensMatchBack(undefined, '我很好')).toBe(true)
})
