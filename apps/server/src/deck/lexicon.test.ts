import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLexicon, writeLexicon } from './lexicon'
import {
  buildLexicon,
  coverage,
  curatedWords,
  harvestWords,
  wordsMissingMeanings,
} from './lexiconBuild'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser } from '../db/repo'

test('a lexicon round-trips through its file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'lex-')), 'zh.json')
  const lex = buildLexicon('zh', ['我', '你'], [new Map([['我', { meaning: 'I / me' }]])])
  writeLexicon(file, lex)
  const back = readLexicon(file)!
  expect(back.lang).toBe('zh')
  expect(back.words['我']).toEqual({ rank: 1, meaning: 'I / me' })
  expect(back.words['你']!.rank).toBe(2)
})

test('coverage counts meanings and readings, and lists the gaps by rank', () => {
  const lex = buildLexicon('ja', ['a', 'b', 'c'], [new Map([['b', { reading: 'R' }]])])
  expect(coverage(lex)).toEqual({ total: 3, meanings: 0, readings: 1 })
  expect(wordsMissingMeanings(lex, 2)).toEqual(['a', 'b'])
})

test('harvesting a deck keeps single words that carry a reading or a meaning', () => {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'l', passwordHash: 'x' })
  const deck = createDeck(db, user.id, { name: 'd', sourceLang: 'en', targetLang: 'ja' })
  const add = (back: string, front: string, readings: Record<string, string>) =>
    addCard(db, user.id, {
      deckId: deck.id,
      sourceLang: 'en',
      targetLang: 'ja',
      front,
      back,
      readings,
      tags: [],
      payload: { template: 'vocab' },
      origin: 'curated',
    })
  add('私', 'I', { kana: 'わたし' })
  add('これは本です。', 'This is a book.', {})
  add('本', 'book', { kana: 'ほん' })
  const words = harvestWords(db, 'ja')
  expect([...words.keys()].sort()).toEqual(['本', '私'])
  expect(words.get('私')).toEqual({ reading: 'わたし', meaning: 'I' })
  sqlite.close()
})

test('the curated lists supply readings and meanings for Chinese and Japanese', () => {
  expect(curatedWords('zh').get('我')).toEqual({ reading: 'ㄨㄛˇ', meaning: 'I, me' })
  expect(curatedWords('ja').get('水')).toEqual({ reading: 'みず', meaning: 'water' })
  expect(curatedWords('ko').size).toBe(0)
})

test('a language without a reading script keeps only the meaning', () => {
  const lex = buildLexicon('ko', ['저'], [new Map([['저', { reading: 'jeo', meaning: 'I' }]])])
  expect(lex.words['저']).toEqual({ rank: 1, meaning: 'I' })
})
