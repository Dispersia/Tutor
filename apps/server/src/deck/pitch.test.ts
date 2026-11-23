import { expect, test } from 'bun:test'
import { openDb } from '../db/client'
import { addCard, createDeck, createUser, listCards } from '../db/repo'
import { kanjiumContour } from './kanjium'
import { PITCH_BATCH, backfillDeckPitch, pitchTargets, type PitchFetcher } from './pitch'

const FLAT = { levels: ['L', 'H'] as ('H' | 'L')[], drop: 0 }

function deck(n: number) {
  const { db, sqlite } = openDb(':memory:')
  const user = createUser(db, { username: 'p', passwordHash: 'x' })
  const d = createDeck(db, user.id, { name: 'd', sourceLang: 'en', targetLang: 'ja' })
  const add = (back: string, kana: string, template: string) =>
    addCard(db, user.id, {
      deckId: d.id,
      sourceLang: 'en',
      targetLang: 'ja',
      front: back,
      back,
      readings: { kana },
      tags: [],
      payload: { template },
      origin: 'llm',
    })
  for (let i = 0; i < n; i++) add(`ぬぬ${i}`, `ぬぬ${i}`, 'vocab')
  add('学生', 'がくせい', 'vocab')
  add('私は学生です。', 'わたしはがくせいです', 'sentence')
  const annotated = () => listCards(db, user.id, d.id).filter((c) => c.metadata.pitch)
  return { db, sqlite, userId: user.id, deckId: d.id, annotated }
}

test('only word cards are pitch targets', () => {
  const { db, sqlite, userId, deckId } = deck(2)
  const targets = pitchTargets(listCards(db, userId, deckId))
  expect(targets.map((c) => c.back)).toEqual(['ぬぬ0', 'ぬぬ1', '学生'])
  sqlite.close()
})

test('the annotator is called in batches and a failed batch is skipped', async () => {
  const { db, sqlite, userId, deckId, annotated } = deck(PITCH_BATCH * 2 + 10)
  const sizes: number[] = []
  const fetcher: PitchFetcher = async (words) => {
    sizes.push(words.length)
    if (sizes.length === 2) throw new Error('model overflowed')
    return new Map(words.map((w) => [w.word, FLAT]))
  }
  const res = await backfillDeckPitch(db, userId, deckId, fetcher)
  expect(sizes).toEqual([PITCH_BATCH, PITCH_BATCH, 10])
  expect(res.failedBatches).toBe(1)
  expect(res.updated).toBe(1 + PITCH_BATCH + 10)
  expect(annotated().length).toBe(res.updated)
  sqlite.close()
})

test('dictionary contours are written even when the annotator fails outright', async () => {
  expect(kanjiumContour('学生', 'がくせい')).toBeTruthy()
  const failing: PitchFetcher = async () => {
    throw new Error('no key')
  }
  const { db, sqlite, userId, deckId, annotated } = deck(3)
  const res = await backfillDeckPitch(db, userId, deckId, failing)
  expect(res).toMatchObject({ updated: 1, failedBatches: 1 })
  expect(annotated().map((c) => c.back)).toEqual(['学生'])
  sqlite.close()
})

test('a backfill that annotated nothing reports why', async () => {
  const { db, sqlite, userId, deckId } = deck(3)
  const failing: PitchFetcher = async () => {
    throw new Error('no key')
  }
  await backfillDeckPitch(db, userId, deckId, async () => new Map())
  await expect(backfillDeckPitch(db, userId, deckId, failing)).rejects.toThrow('no key')
  sqlite.close()
})
