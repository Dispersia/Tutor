import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { createDeck, createUser, listCards } from '../db/repo'
import { fillDeck } from './build'
import { acceptPlanned } from './intro'
import {
  motionWithoutPlace,
  persistOne,
  readingsForPlanned,
  unseenParts,
  zhuyinFromPinyin,
} from './context'
import { mandarinSentenceZhuyin } from './mandarin'
import type { PlannedCard, Planner } from './plan'

const vocab = (back: string): PlannedCard => ({ template: 'vocab', front: `m ${back}`, back })
const sentence = (back: string, tokens: string[]): PlannedCard => ({
  template: 'sentence',
  front: `m ${back}`,
  back,
  payload: { tokens },
})

const example = (back: string, tokens: string[], distractors: string[]): PlannedCard => ({
  template: 'sentence',
  front: `m ${back}`,
  back,
  payload: { tokens, distractors },
})

const examplesOf = (
  db: ReturnType<typeof emptyDeck>['db'],
  userId: ReturnType<typeof emptyDeck>['userId'],
  deckId: ReturnType<typeof emptyDeck>['deckId'],
) => listCards(db, userId, deckId).filter((c) => c.payload.template !== 'vocab')

const ctx = { instruction: 'x', targetLang: 'es', sourceLang: 'en' }

function emptyDeck(targetLang = 'es') {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'b', passwordHash: 'x' })
  const deck = createDeck(db, user.id, { name: 'd', sourceLang: 'en', targetLang })
  const vocabOf = () =>
    listCards(db, user.id, deck.id)
      .filter((c) => c.payload.template === 'vocab')
      .map((c) => c.back)
  return { db, sqlite, userId: user.id, deckId: deck.id, vocabOf }
}

test('a sentence the deck segmented as one token is stored as a word card', () => {
  const { db, sqlite, userId, deckId } = emptyDeck('ko')
  const opts = { targetLang: 'ko', sourceLang: 'en', startStep: 1, futureWords: new Set<string>() }
  persistOne({
    db,
    userId,
    deckId,
    opts,
    card: {
      template: 'sentence',
      front: 'Yes.',
      back: '네.',
      payload: { tokens: ['네'], gloss: 'Yes.' },
    },
    step: 1,
  })
  persistOne({
    db,
    userId,
    deckId,
    opts,
    card: {
      template: 'sentence',
      front: 'I drink tea.',
      back: '차를 마셔요.',
      payload: { tokens: ['차를', '마셔요.'], gloss: 'I drink tea.' },
    },
    step: 2,
  })
  const cards = listCards(db, userId, deckId)
  expect(cards.map((c) => `${c.type}:${c.payload.template}:${c.back}`)).toEqual([
    'vocab:vocab:네.',
    'phrase:sentence:차를 마셔요.',
  ])
  sqlite.close()
})

test('acceptPlanned keeps requested vocab once, in a leading run', () => {
  const planned = [vocab('a'), vocab('zzz'), vocab('a'), sentence('a a', ['a', 'a']), vocab('c')]
  const got = acceptPlanned(planned, ['a', 'b', 'c'])
  expect(got.introduced).toBe(1)
  expect(got.cards.map((c) => `${c.template}:${c.back}`)).toEqual(['vocab:a', 'sentence:a a'])
  expect(acceptPlanned([vocab(' Agua ')], ['agua']).cards[0]!.back).toBe('agua')
  expect(acceptPlanned([vocab('x')], ['a']).introduced).toBe(0)
})

const grammarPoint = (back: string, front: string, intro = true): PlannedCard => ({
  template: 'grammar',
  front,
  back,
  payload: {
    prompt: '私___です。',
    answer: back,
    options: [back, 'zzz'],
    rule: 'a point',
    explanation: 'what it means and how it is used',
    ...(intro ? { intro: true } : {}),
  },
})

test('a grammar point introduces its word in place of a vocab card', () => {
  const point = grammarPoint('は', 'Topic particle: は / が')
  const planned = [
    vocab('私'),
    point,
    vocab('は'),
    sentence('私は学生です。', ['私', 'は', '学生', 'です']),
  ]
  const got = acceptPlanned(planned, ['私', 'は', '学生'])
  expect(got.introduced).toBe(2)
  expect(got.cards.map((c) => `${c.template}:${c.back}`)).toEqual([
    'vocab:私',
    'grammar:は',
    'sentence:私は学生です。',
  ])
  expect(got.cards[1]!.payload?.intro).toBe(true)
})

test('a pattern grammar card does not replace the word card it uses', () => {
  const pattern = grammarPoint('喝', 'verb before object', false)
  const planned = [vocab('我'), vocab('喝'), pattern, vocab('茶')]
  const got = acceptPlanned(planned, ['我', '喝', '茶'])
  expect(got.introduced).toBe(3)
  expect(got.cards.map((c) => `${c.template}:${c.back}`)).toEqual([
    'vocab:我',
    'vocab:喝',
    'grammar:喝',
    'vocab:茶',
  ])
  expect(got.cards[1]!.payload?.intro).toBeUndefined()
  expect(got.cards[2]!.payload?.intro).toBeUndefined()
})

test('a word taught by its grammar card is known to the cards that follow it', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('ja')
  const planner: Planner = async (req) =>
    req.words.includes('は')
      ? [
          grammarPoint('は', 'Topic particle: は / が'),
          sentence('私は学生です。', ['私', 'は', '学生', 'です']),
          ...req.words.filter((w) => w !== 'は').map(vocab),
        ]
      : req.words.map(vocab)
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'ja' },
    opts: { words: ['は'], count: 1, knownWords: ['私', '学生', 'です'] },
    planner,
  })
  const cards = listCards(db, userId, deckId)
  expect(cards.map((c) => `${c.type}:${c.back}`)).toEqual(['grammar:は', 'phrase:私は学生です。'])
  expect(cards[0]!.payload.intro).toBe(true)
  sqlite.close()
})

function grammarExample(
  db: ReturnType<typeof emptyDeck>['db'],
  userId: ReturnType<typeof emptyDeck>['userId'],
  deckId: ReturnType<typeof emptyDeck>['deckId'],
) {
  return listCards(db, userId, deckId).find((c) => c.type === 'grammar')?.payload.example
}

test('a grammar card is built with an example verified against the known words', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('ja')
  const planner: Planner = async (req) =>
    req.reinforce
      ? [sentence('私は学生です。', ['私', 'は', '学生', 'です'])]
      : [grammarPoint('は', 'Topic particle: は / が')]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'ja' },
    opts: { words: ['は'], count: 1, knownWords: ['私', '学生', 'です'] },
    planner,
  })
  expect(grammarExample(db, userId, deckId)).toMatchObject({ text: '私は学生です。' })
  sqlite.close()
})

test('a grammar example that uses an unmet word is not stored', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('ja')
  const planner: Planner = async (req) =>
    req.reinforce
      ? [sentence('私は先生です。', ['私', 'は', '先生', 'です'])]
      : [grammarPoint('は', 'Topic particle: は / が')]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'ja' },
    opts: { words: ['は'], count: 1, knownWords: ['私', '学生', 'です'] },
    planner,
  })
  expect(grammarExample(db, userId, deckId)).toBeUndefined()
  sqlite.close()
})

test('a batch that returns fewer words only counts those, and retries the rest', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  const asked: string[][] = []
  const planner: Planner = async (req) => {
    if (!req.reinforce) asked.push(req.words)
    return req.words.slice(0, 2).map(vocab)
  }
  const progress: number[] = []
  const words = ['a', 'b', 'c', 'd', 'e']
  const opts = { words, count: 5, onProgress: (built: number) => void progress.push(built) }
  const res = await fillDeck(db, userId, deckId, { ctx, opts, planner })
  expect(res.built).toBe(5)
  expect(res.newWords).toEqual(words)
  expect(vocabOf()).toEqual(words)
  expect(asked).toEqual([words, ['c', 'd', 'e'], ['e']])
  expect(progress).toEqual([2, 4, 5])
  sqlite.close()
})

test('invented vocabulary is not persisted', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  const planner: Planner = async (req) => [...req.words.map(vocab), vocab('inventado')]
  const res = await fillDeck(db, userId, deckId, {
    ctx,
    opts: { words: ['a', 'b'], count: 2 },
    planner,
  })
  expect(res.newWords).toEqual(['a', 'b'])
  expect(vocabOf()).toEqual(['a', 'b'])
  sqlite.close()
})

test('a Chinese motion verb left without a place is a bad sentence', () => {
  const bad = sentence('來這，去那。', ['來', '這', '去', '那'])
  expect(motionWithoutPlace('zh', bad)).toBe(true)
  expect(motionWithoutPlace('zh', sentence('來這裡。', ['來', '這裡']))).toBe(false)
  expect(motionWithoutPlace('zh', sentence('我去了。', ['我', '去', '了']))).toBe(false)
  expect(motionWithoutPlace('zh', sentence('去這家店。', ['去', '這', '家', '店']))).toBe(false)
  expect(motionWithoutPlace('es', bad)).toBe(false)
})

test('the build drops a Chinese sentence that writes 來這 or 去那', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('zh')
  const planner: Planner = async (req) => [
    ...req.words.map(vocab),
    sentence('來這，去那。', ['來', '這', '去', '那']),
  ]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'zh' },
    opts: { words: ['我', '去'], count: 2 },
    planner,
  })
  const examples = listCards(db, userId, deckId).filter((c) => c.payload.template !== 'vocab')
  expect(examples).toEqual([])
  sqlite.close()
})

test('a Chinese sentence that uses a word introduced later is dropped', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('zh')
  const planner: Planner = async (req) =>
    req.reinforce
      ? []
      : [
          vocab('我'),
          sentence('我喝朋友。', ['我', '喝', '朋友']),
          ...req.words.filter((w) => w !== '我').map(vocab),
        ]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'zh' },
    opts: { words: ['我', '喝', '朋友'], count: 3 },
    planner,
  })
  expect(examplesOf(db, userId, deckId)).toEqual([])
  sqlite.close()
})

test('the unseen-word check runs for every language, not just Chinese', () => {
  const ko = sentence('사람 있어요.', ['사람', '있어요.'])
  expect(unseenParts(ko, new Set(['사람'])).words).toEqual(['있어요.'])
  expect(unseenParts(ko, new Set(['사람', '있어요'])).words).toEqual([])

  const ja = sentence('私です。', ['私', 'です'])
  expect(unseenParts(ja, new Set(['私'])).words).toEqual(['です'])
  expect(unseenParts(ja, new Set(['私', 'です'])).words).toEqual([])

  const es = sentence('Bebo agua.', ['Bebo', 'agua'])
  expect(unseenParts(es, new Set(['Bebo'])).words).toEqual(['agua'])
})

test('a sentence without tokens is checked by its own text', () => {
  const bare: PlannedCard = {
    template: 'sentence',
    front: 'There are people.',
    back: '사람 있어요.',
    payload: {},
  }
  expect(unseenParts(bare, new Set(['사람'])).words).toEqual(['있어요'])
})

test('a punctuation-only token is not an unknown word', () => {
  const card = sentence('저는...', ['저', '는', '...'])
  expect(unseenParts(card, new Set(['저', '는'])).words).toEqual([])
})

test('a sentence that runs ahead of its words is retried with the known ones', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('ko')
  const planner: Planner = async (req) => {
    if (req.reinforce) return [sentence('사람 있어요.', ['사람', '있어요.'])]
    return [vocab('사람'), sentence('사람 있어요.', ['사람', '있어요.']), vocab('있어요')]
  }
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'ko' },
    opts: { words: ['사람', '있어요'], count: 2 },
    planner,
  })
  const phrases = listCards(db, userId, deckId).filter((c) => c.payload.template !== 'vocab')
  expect(phrases.map((c) => c.back)).toEqual(['사람 있어요.'])
  sqlite.close()
})

test('a grammar card the guard rejects still leaves a vocab card for its word', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('ko')
  const bad: PlannedCard = {
    template: 'grammar',
    front: 'Topic particle: 는 / 은',
    back: '는',
    payload: {
      prompt: '저___ 학생이에요.',
      answer: '는',
      options: ['는', '은'],
      rule: 'topic particle',
      intro: true,
    },
  }
  const planner: Planner = async (req) => (req.reinforce ? [] : [vocab('저'), bad])
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'ko' },
    opts: { words: ['저', '는'], count: 2 },
    planner,
  })
  const backs = listCards(db, userId, deckId).map((c) => `${c.type}:${c.back}`)
  expect(backs).toContain('vocab:는')
  sqlite.close()
})

test('a grammar prompt is checked against the known words in every script', () => {
  const ko: PlannedCard = {
    template: 'grammar',
    front: 'Topic particle: 는 / 은',
    back: '는',
    payload: { prompt: '저___ 학생이에요.', answer: '는' },
  }
  expect(unseenParts(ko, new Set(['저', '는'])).words).toEqual(['학생이에요'])
})

test('a Chinese sentence that uses a word outside the deck is dropped', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('zh')
  const planner: Planner = async (req) => [
    ...req.words.map(vocab),
    sentence('我愛海。', ['我', '愛', '海']),
  ]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'zh' },
    opts: { words: ['我', '愛'], count: 2 },
    planner,
  })
  expect(examplesOf(db, userId, deckId)).toEqual([])
  sqlite.close()
})

test('a Chinese sentence keeps a compound of known characters', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('zh')
  const planner: Planner = async (req) => [
    ...req.words.map(vocab),
    sentence('我愛你的。', ['我', '愛', '你的']),
  ]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'zh' },
    opts: { words: ['我', '愛', '你', '的'], count: 4 },
    planner,
  })
  expect(examplesOf(db, userId, deckId)).toHaveLength(1)
  sqlite.close()
})

test('a sentence whose distractor is an unmet word keeps the sentence, dropping the distractor', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('zh')
  let calls = 0
  const planner: Planner = async (req) => {
    calls++
    if (calls > 1) return req.words.map(vocab)
    return [
      vocab('我'),
      vocab('喝'),
      vocab('茶'),
      example('我喝茶。', ['我', '喝', '茶'], ['書']),
      vocab('書'),
    ]
  }
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'zh' },
    opts: { words: ['我', '喝', '茶', '書'], count: 4 },
    planner,
  })
  const examples = examplesOf(db, userId, deckId)
  expect(examples).toHaveLength(1)
  expect(examples[0]!.payload.distractors).toEqual([])
  sqlite.close()
})

test('a word the model never returns still gets a vocab card', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  let calls = 0
  const planner: Planner = async (req) => {
    if (!req.reinforce) calls++
    return req.words.filter((w) => w !== 'c').map(vocab)
  }
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  await fillDeck(db, userId, deckId, { ctx, opts: { words, count: 8 }, planner })
  expect(vocabOf()).toEqual(words)
  expect(calls).toBeLessThan(12)
  sqlite.close()
})

test('the same word never gets a second card of the same kind in one deck', () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  const opts = { targetLang: 'es', sourceLang: 'en', startStep: 1, futureWords: new Set<string>() }
  const write = (card: PlannedCard) => persistOne({ db, userId, deckId, opts, card, step: 1 })
  expect(write(vocab('hola'))).toBe(true)
  expect(write(vocab('hola'))).toBe(false)
  expect(write(sentence('hola amigo.', ['hola', 'amigo']))).toBe(true)
  expect(write(sentence('hola amigo.', ['hola', 'amigo']))).toBe(false)
  expect(write(sentence('hola.', ['hola']))).toBe(false)
  expect(vocabOf()).toEqual(['hola'])
  sqlite.close()
})

test('a growth batch cannot add a word the deck already has', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  const opts = { targetLang: 'es', sourceLang: 'en', startStep: 1, futureWords: new Set<string>() }
  persistOne({ db, userId, deckId, opts, card: vocab('uno'), step: 1 })
  const planner: Planner = async (req) => req.words.map(vocab)
  await fillDeck(db, userId, deckId, {
    ctx,
    opts: { words: ['uno', 'dos'], count: 2, knownWords: ['uno'], startStep: 1 },
    planner,
  })
  expect(vocabOf()).toEqual(['uno', 'dos'])
  sqlite.close()
})

test('a pinyin reading becomes clean Zhuyin, or is replaced — never stored with "?"', () => {
  expect(zhuyinFromPinyin('Nǐ hǎo!')).toBe('ㄋㄧˇ ㄏㄠˇ')
  expect(zhuyinFromPinyin('Nǐ hǎo, shìjiè.')).toBe('ㄋㄧˇ ㄏㄠˇ ㄕˋ ㄐㄧㄝˋ')
  expect(zhuyinFromPinyin('ni3 hao3')).toBeUndefined()
  expect(zhuyinFromPinyin('nei5 hou2')).toBeUndefined()

  expect(readingsForPlanned('zh', 'Nǐ hǎo!', 'zhuyin', '你好')).toEqual({ zhuyin: 'ㄋㄧˇ ㄏㄠˇ' })
  const fromDictionary = mandarinSentenceZhuyin('你好')!
  expect(fromDictionary).not.toMatch(/[?a-z0-9]/i)
  expect(readingsForPlanned('zh', 'ni3 hao3', 'zhuyin', '你好')).toEqual({ zhuyin: fromDictionary })
  expect(readingsForPlanned('zh', 'ni3 hao3', 'zhuyin')).toEqual({})
  expect(readingsForPlanned('yue', 'nei5 hou2', 'zhuyin', '你好')).toEqual({})
  expect(readingsForPlanned('zh', 'nǐ hǎo', 'pinyin', '你好')).toEqual({ pinyin: 'nǐ hǎo' })
  expect(readingsForPlanned('zh', 'ㄋㄧˇ ㄏㄠˇ', 'zhuyin', '你好')).toEqual({
    zhuyin: 'ㄋㄧˇ ㄏㄠˇ',
  })
})
