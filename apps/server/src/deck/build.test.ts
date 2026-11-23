import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { createDeck, createUser, listCards } from '../db/repo'
import { acceptPlanned, fillDeck } from './build'
import { readingsForPlanned, zhuyinFromPinyin } from './context'
import { mandarinSentenceZhuyin } from './mandarin'
import type { PlannedCard, Planner } from './plan'

const vocab = (back: string): PlannedCard => ({ template: 'vocab', front: `m ${back}`, back })
const sentence = (back: string, tokens: string[]): PlannedCard => ({
  template: 'sentence',
  front: `m ${back}`,
  back,
  payload: { tokens },
})

const ctx = { instruction: 'x', targetLang: 'es', sourceLang: 'en' }

function emptyDeck() {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'b', passwordHash: 'x' })
  const deck = createDeck(db, user.id, { name: 'd', sourceLang: 'en', targetLang: 'es' })
  const vocabOf = () =>
    listCards(db, user.id, deck.id)
      .filter((c) => c.payload.template === 'vocab')
      .map((c) => c.back)
  return { db, sqlite, userId: user.id, deckId: deck.id, vocabOf }
}

test('acceptPlanned keeps requested vocab once, in a leading run', () => {
  const planned = [vocab('a'), vocab('zzz'), vocab('a'), sentence('a a', ['a', 'a']), vocab('c')]
  const got = acceptPlanned(planned, ['a', 'b', 'c'])
  // b is missing, so only a counts: c is asked for again with b, not duplicated
  expect(got.introduced).toBe(1)
  expect(got.cards.map((c) => `${c.template}:${c.back}`)).toEqual(['vocab:a', 'sentence:a a'])
  // spacing/case differences still match, and the stored word is the requested one
  expect(acceptPlanned([vocab(' Agua ')], ['agua']).cards[0]!.back).toBe('agua')
  expect(acceptPlanned([vocab('x')], ['a']).introduced).toBe(0)
})

test('a batch that returns fewer words only counts those, and retries the rest', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  const asked: string[][] = []
  // The model answers two words per call, however many it was asked for.
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
  expect(vocabOf()).toEqual(words) // none lost, none doubled
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

test('a word the model never returns is skipped, and the rest of the deck is built', async () => {
  const { db, sqlite, userId, deckId, vocabOf } = emptyDeck()
  let calls = 0
  const planner: Planner = async (req) => {
    calls++
    return req.words.filter((w) => w !== 'c').map(vocab)
  }
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  await fillDeck(db, userId, deckId, { ctx, opts: { words, count: 8 }, planner })
  // the batch shrinks down to the stuck word, skips it, and carries on
  expect(vocabOf()).toEqual(['a', 'b', 'd', 'e', 'f', 'g', 'h'])
  expect(calls).toBeLessThan(12)
  sqlite.close()
})

test('a pinyin reading becomes clean Zhuyin, or is replaced — never stored with "?"', () => {
  expect(zhuyinFromPinyin('Nǐ hǎo!')).toBe('ㄋㄧˇ ㄏㄠˇ')
  expect(zhuyinFromPinyin('Nǐ hǎo, shìjiè.')).toBe('ㄋㄧˇ ㄏㄠˇ ㄕˋ ㄐㄧㄝˋ')
  expect(zhuyinFromPinyin('ni3 hao3')).toBeUndefined() // tone digits
  expect(zhuyinFromPinyin('nei5 hou2')).toBeUndefined() // jyutping

  expect(readingsForPlanned('zh', 'Nǐ hǎo!', 'zhuyin', '你好')).toEqual({ zhuyin: 'ㄋㄧˇ ㄏㄠˇ' })
  // unconvertible: the model's reading is dropped for the dictionary's
  const fromDictionary = mandarinSentenceZhuyin('你好')!
  expect(fromDictionary).not.toMatch(/[?a-z0-9]/i)
  expect(readingsForPlanned('zh', 'ni3 hao3', 'zhuyin', '你好')).toEqual({ zhuyin: fromDictionary })
  expect(readingsForPlanned('zh', 'ni3 hao3', 'zhuyin')).toEqual({})
  // Cantonese is never run through the Mandarin converter
  expect(readingsForPlanned('yue', 'nei5 hou2', 'zhuyin', '你好')).toEqual({ reading: 'nei5 hou2' })
  expect(readingsForPlanned('zh', 'nǐ hǎo', 'pinyin', '你好')).toEqual({ pinyin: 'nǐ hǎo' })
  expect(readingsForPlanned('zh', 'ㄋㄧˇ ㄏㄠˇ', 'zhuyin', '你好')).toEqual({
    zhuyin: 'ㄋㄧˇ ㄏㄠˇ',
  })
})
