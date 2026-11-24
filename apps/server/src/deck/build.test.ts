import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { createDeck, createUser, listCards } from '../db/repo'
import { acceptPlanned, fillDeck } from './build'
import { motionWithoutPlace, readingsForPlanned, zhuyinFromPinyin } from './context'
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

test('acceptPlanned keeps requested vocab once, in a leading run', () => {
  const planned = [vocab('a'), vocab('zzz'), vocab('a'), sentence('a a', ['a', 'a']), vocab('c')]
  const got = acceptPlanned(planned, ['a', 'b', 'c'])
  expect(got.introduced).toBe(1)
  expect(got.cards.map((c) => `${c.template}:${c.back}`)).toEqual(['vocab:a', 'sentence:a a'])
  expect(acceptPlanned([vocab(' Agua ')], ['agua']).cards[0]!.back).toBe('agua')
  expect(acceptPlanned([vocab('x')], ['a']).introduced).toBe(0)
})

test('a batch that returns fewer words only counts those, and retries the rest', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  const asked: string[][] = []
  const planner: Planner = async (req) => {
    asked.push(req.words)
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
  const planner: Planner = async (req) => [
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

test('a sentence whose distractor is an unmet word is dropped', async () => {
  const { db, sqlite, userId, deckId } = emptyDeck('zh')
  const planner: Planner = async () => [
    vocab('我'),
    vocab('喝'),
    vocab('茶'),
    example('我喝茶。', ['我', '喝', '茶'], ['書']),
    vocab('書'),
  ]
  await fillDeck(db, userId, deckId, {
    ctx: { ...ctx, targetLang: 'zh' },
    opts: { words: ['我', '喝', '茶', '書'], count: 4 },
    planner,
  })
  expect(examplesOf(db, userId, deckId)).toEqual([])
  sqlite.close()
})

test('a word the model never returns is skipped, and the rest of the deck is built', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  let calls = 0
  const planner: Planner = async (req) => {
    calls++
    return req.words.filter((w) => w !== 'c').map(vocab)
  }
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  await fillDeck(db, userId, deckId, { ctx, opts: { words, count: 8 }, planner })
  expect(vocabOf()).toEqual(['a', 'b', 'd', 'e', 'f', 'g', 'h'])
  expect(calls).toBeLessThan(12)
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
  expect(readingsForPlanned('yue', 'nei5 hou2', 'zhuyin', '你好')).toEqual({ reading: 'nei5 hou2' })
  expect(readingsForPlanned('zh', 'nǐ hǎo', 'pinyin', '你好')).toEqual({ pinyin: 'nǐ hǎo' })
  expect(readingsForPlanned('zh', 'ㄋㄧˇ ㄏㄠˇ', 'zhuyin', '你好')).toEqual({
    zhuyin: 'ㄋㄧˇ ㄏㄠˇ',
  })
})
